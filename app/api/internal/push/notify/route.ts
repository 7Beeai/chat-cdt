import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendPush, type PushSubscription } from '@/lib/push'

export const runtime = 'nodejs'

type Body = {
  conversation_id: string
  unit_id: string
  reason?: string
}

const REASON_LABEL: Record<string, string> = {
  payment_re_register: 'Recadastro de pagamento',
  cancel: 'Cancelamento de assinatura',
  other_support: 'Suporte específico',
}

export async function POST(req: NextRequest) {
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  if (!body?.conversation_id || !body?.unit_id) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // 1) user_units -> profiles.id list
  const { data: uu, error: uuErr } = await supabase
    .from('user_units')
    .select('user_id')
    .eq('unit_id', body.unit_id)
  if (uuErr) {
    console.error('[push/notify] user_units lookup failed', uuErr)
    return NextResponse.json({ ok: true, sent: 0, removed: 0 })
  }
  const profileIds = (uu ?? []).map((r) => r.user_id as string)
  if (profileIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, removed: 0 })
  }

  // 2) profiles.id -> profiles.user_id (auth.users.id)
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('user_id')
    .in('id', profileIds)
  if (pErr) {
    console.error('[push/notify] profiles lookup failed', pErr)
    return NextResponse.json({ ok: true, sent: 0, removed: 0 })
  }
  const authUserIds = (profiles ?? [])
    .map((p) => p.user_id as string | null)
    .filter((v): v is string => !!v)
  if (authUserIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, removed: 0 })
  }

  // 3) subscriptions for those users
  const { data: subs, error: sErr } = await supabase
    .from('chat_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', authUserIds)
  if (sErr) {
    console.error('[push/notify] subscriptions lookup failed', sErr)
    return NextResponse.json({ ok: true, sent: 0, removed: 0 })
  }

  const payload = {
    title: 'Novo handoff',
    body:
      (body.reason && REASON_LABEL[body.reason]) ||
      'Conversa aguardando atendimento',
    url: `/inbox/${body.conversation_id}`,
    tag: body.conversation_id,
  }

  let sent = 0
  let removed = 0
  for (const row of subs ?? []) {
    const sub: PushSubscription = {
      endpoint: row.endpoint as string,
      p256dh: row.p256dh as string,
      auth: row.auth as string,
    }
    try {
      await sendPush(sub, payload)
      sent++
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string }
      if (e.statusCode === 404 || e.statusCode === 410) {
        const { error: delErr } = await supabase
          .from('chat_push_subscriptions')
          .delete()
          .eq('id', row.id)
        if (delErr) {
          console.error('[push/notify] stale subscription delete failed', delErr)
        } else {
          removed++
        }
      } else {
        console.warn(
          '[push/notify] sendPush failed for subscription',
          row.id,
          e.statusCode ?? '',
          e.message ?? err
        )
      }
    }
  }

  return NextResponse.json({ ok: true, sent, removed })
}
