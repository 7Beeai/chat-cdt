import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { graphSendMessage } from '@/lib/meta/graph'
import { handleGraphOutOfWindow, isGraphOutOfWindow } from '@/lib/meta/window'

export const runtime = 'nodejs'

const bodySchema = z
  .object({
    conversationId: z.string().uuid(),
    type: z.enum(['text', 'template', 'image', 'document']),
    text: z.string().min(1).max(4096).optional(),
    template: z
      .object({
        name: z.string(),
        language: z.string().default('pt_BR'),
        components: z.array(z.any()).optional(),
        // Display-only: corpo resolvido (variáveis preenchidas) e textos dos
        // quick replies. NÃO vão pra Meta — ficam no payload persistido pra
        // bolha renderizar o template como no WhatsApp.
        body_text: z.string().max(4096).optional(),
        buttons: z.array(z.string().max(64)).max(5).optional(),
      })
      .optional(),
    mediaUrl: z.string().url().optional(),
    caption: z.string().optional(),
  })
  .refine((b) => b.type !== 'text' || !!b.text, {
    message: 'text required when type=text',
    path: ['text'],
  })
  .refine((b) => b.type !== 'template' || !!b.template, {
    message: 'template required when type=template',
    path: ['template'],
  })
  .refine(
    (b) => (b.type !== 'image' && b.type !== 'document') || !!b.mediaUrl,
    { message: 'mediaUrl required for image/document', path: ['mediaUrl'] }
  )

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const body = parsed.data

  // Conversation lookup (passes RLS — user must own it).
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select(
      `
        id, status, routing, customer_window_expires_at,
        phone:chat_phone_numbers(phone_number_id),
        contact:contacts(wa_id)
      `
    )
    .eq('id', body.conversationId)
    .maybeSingle()

  if (convErr) {
    console.error('[messages/send] conversation lookup error', convErr)
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }
  if (!conv) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const phone = (conv as any).phone as { phone_number_id: string } | null
  const contact = (conv as any).contact as { wa_id: string } | null
  if (!phone?.phone_number_id || !contact?.wa_id) {
    console.error('[messages/send] missing phone or contact on conversation', conv.id)
    return NextResponse.json({ error: 'conversation_incomplete' }, { status: 500 })
  }

  // 24h window only enforced for free-form text. Templates can bypass.
  if (body.type === 'text') {
    const exp = conv.customer_window_expires_at
      ? new Date(conv.customer_window_expires_at).getTime()
      : 0
    if (!exp || exp < Date.now()) {
      return NextResponse.json({ error: 'out_of_window' }, { status: 409 })
    }
  }

  // Build Graph payload.
  const graphBody: any = {
    messaging_product: 'whatsapp',
    to: contact.wa_id,
    type: body.type,
  }
  if (body.type === 'text') {
    graphBody.text = { body: body.text, preview_url: false }
  } else if (body.type === 'template') {
    // Cloud API exige language como OBJETO {code} — string viola o schema
    // ("violated JSON schema constraint 'type' for template.language").
    // O client manda string; a conversão fica aqui pra valer pra todo caller.
    // body_text/buttons são display-only e NÃO entram no payload da Meta.
    const { body_text: _bt, buttons: _btns, ...tpl } = body.template!
    graphBody.template = {
      ...tpl,
      language: { code: tpl.language },
    }
  } else if (body.type === 'image') {
    graphBody.image = { link: body.mediaUrl, caption: body.caption }
  } else if (body.type === 'document') {
    graphBody.document = { link: body.mediaUrl, caption: body.caption }
  }

  const result = await graphSendMessage(phone.phone_number_id, graphBody)
  if (!result.ok) {
    console.error('[messages/send] graph error', result.status, result.body)
    // Janela local aberta mas a Meta recusou (131047/131026): trata como
    // out-of-window — zera a janela e devolve o mesmo 409 do gate local.
    // Não se aplica a template (template é justamente o caminho de retomada).
    if (body.type !== 'template' && isGraphOutOfWindow(result.body)) {
      return handleGraphOutOfWindow(conv.id, result.body)
    }
    return NextResponse.json(
      { error: 'graph', status: result.status, details: result.body },
      { status: 502 }
    )
  }

  // Persist the outbound row. The conversation SELECT above already passed
  // RLS (user owns this unit), so the cookie-client insert should also pass.
  // If it fails for any reason (constraint, network, transient RLS hiccup),
  // fall back to the service-role client — the message DID go to the customer
  // via Graph, and the row must land for Realtime to reflect it in the UI.
  const row = {
    conversation_id: conv.id,
    wa_message_id: result.waMessageId,
    direction: 'out' as const,
    type: body.type,
    // Template: anexa corpo resolvido + quick replies ao payload persistido —
    // a bolha renderiza o texto real em vez de "[template: nome]".
    payload:
      body.type === 'template' &&
      (body.template?.body_text || body.template?.buttons?.length)
        ? {
            ...graphBody,
            ...(body.template.body_text
              ? { body_text: body.template.body_text }
              : {}),
            ...(body.template.buttons?.length
              ? { template_buttons: body.template.buttons }
              : {}),
          }
        : graphBody,
    sent_by: 'operator' as const,
    operator_id: user.id,
    status: 'sent' as const,
  }

  const { error: insErr } = await supabase.from('messages').insert(row)
  if (insErr) {
    console.warn('[messages/send] cookie-client insert failed, retrying with service role', insErr)
    const { error: svcErr } = await createServiceClient().from('messages').insert(row)
    if (svcErr) {
      console.error('[messages/send] service-role insert also failed', svcErr)
      return NextResponse.json(
        { error: 'persist_failed', wa_message_id: result.waMessageId },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ ok: true, wa_message_id: result.waMessageId })
}
