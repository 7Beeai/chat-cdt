import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import type {
  WebhookEnvelope,
  WebhookMessage,
  WebhookStatus,
} from '@/lib/meta/types'

// Webhook roda em Node (crypto + raw body). Não pode rotear ou cachear.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// --- GET: verification handshake -----------------------------------------
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 })
  }
  return new NextResponse('forbidden', { status: 403 })
}

// --- POST: receive events ------------------------------------------------
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('x-hub-signature-256') ?? ''
  const secret = process.env.META_APP_SECRET

  if (!secret) {
    console.error('[webhook] META_APP_SECRET not configured')
    return new NextResponse('misconfigured', { status: 500 })
  }

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(raw).digest('hex')

  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return new NextResponse('bad signature', { status: 401 })
  }

  let body: WebhookEnvelope
  try {
    body = JSON.parse(raw)
  } catch {
    return new NextResponse('bad json', { status: 400 })
  }

  const supabase = createServiceClient()

  // Audit log (best-effort, não bloqueia ACK).
  supabase
    .from('chat_webhook_events')
    .insert({ payload: body })
    .then(({ error }) => {
      if (error) console.error('[webhook] audit insert failed', error)
    })

  // ACK rápido. Meta retenta se > 5s.
  queueMicrotask(() =>
    processEnvelope(body).catch((err) =>
      console.error('[webhook] process error', err)
    )
  )

  return NextResponse.json({ ok: true })
}

// --- processing ----------------------------------------------------------

async function processEnvelope(body: WebhookEnvelope) {
  const supabase = createServiceClient()

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue

      const v = change.value
      const phoneNumberId = v.metadata?.phone_number_id
      if (!phoneNumberId) continue

      // Resolve phone -> waba -> unit.
      const { data: phone, error: phoneErr } = await supabase
        .from('chat_phone_numbers')
        .select('id, waba_id, wabas!inner(unit_id)')
        .eq('phone_number_id', phoneNumberId)
        .maybeSingle()

      if (phoneErr) {
        console.error('[webhook] phone lookup error', phoneErr)
        continue
      }
      if (!phone) {
        console.warn(
          '[webhook] unknown phone_number_id; not registered in chat_phone_numbers:',
          phoneNumberId
        )
        continue
      }
      const unitId = (phone as any).wabas.unit_id as string

      for (const msg of v.messages ?? []) {
        await handleInboundMessage(supabase, {
          unitId,
          phoneRowId: phone.id,
          contactProfileName: v.contacts?.[0]?.profile?.name,
          msg,
        })
      }

      for (const st of v.statuses ?? []) {
        await handleStatus(supabase, st)
      }
    }
  }
}

async function handleInboundMessage(
  supabase: ReturnType<typeof createServiceClient>,
  args: {
    unitId: string
    phoneRowId: string
    contactProfileName?: string
    msg: WebhookMessage
  }
) {
  const { unitId, phoneRowId, contactProfileName, msg } = args

  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .upsert(
      {
        unit_id: unitId,
        wa_id: msg.from,
        name: contactProfileName ?? undefined,
      },
      { onConflict: 'unit_id,wa_id' }
    )
    .select('id')
    .single()
  if (contactErr || !contact) {
    console.error('[webhook] contact upsert failed', contactErr)
    return
  }

  const conversationId = await getOrCreateOpenConversation(supabase, {
    unitId,
    contactId: contact.id,
    phoneRowId,
  })
  if (!conversationId) return

  const { error: msgErr } = await supabase.from('messages').upsert(
    {
      conversation_id: conversationId,
      wa_message_id: msg.id,
      direction: 'in' as const,
      type: msg.type,
      payload: msg,
      sent_by: 'customer' as const,
      status: 'delivered' as const,
    },
    { onConflict: 'wa_message_id', ignoreDuplicates: true }
  )
  if (msgErr) console.error('[webhook] message insert failed', msgErr)
}

async function getOrCreateOpenConversation(
  supabase: ReturnType<typeof createServiceClient>,
  args: { unitId: string; contactId: string; phoneRowId: string }
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', args.contactId)
    .eq('status', 'open')
    .maybeSingle()
  if (existing) return existing.id

  const { data: created, error: insErr } = await supabase
    .from('conversations')
    .insert({
      unit_id: args.unitId,
      contact_id: args.contactId,
      phone_number_id: args.phoneRowId,
    })
    .select('id')
    .maybeSingle()

  if (created) return created.id

  // 23505 = unique_violation on uniq_open_conv_per_contact (race c/ n8n)
  if (insErr && (insErr as any).code === '23505') {
    const { data: again } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', args.contactId)
      .eq('status', 'open')
      .maybeSingle()
    return again?.id ?? null
  }

  console.error('[webhook] conversation insert failed', insErr)
  return null
}

async function handleStatus(
  supabase: ReturnType<typeof createServiceClient>,
  st: WebhookStatus
) {
  const { error } = await supabase
    .from('messages')
    .update({
      status: st.status,
      error: st.errors ?? null,
    })
    .eq('wa_message_id', st.id)
  if (error) console.error('[webhook] status update failed', error)
}
