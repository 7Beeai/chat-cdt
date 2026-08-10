import { notFound, redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { createMediaSignedUrl, extractMediaInfo } from '@/lib/storage/media'

import { ThreadPane } from '@/components/inbox/thread-pane'
import type {
  ConversationView,
  Message,
} from '@/app/(app)/inbox/[id]/page'

export const dynamic = 'force-dynamic'

/**
 * Thread da Área de Vendas — versão MONITOR da thread da inbox: mesma
 * renderização de mensagens/mídia, sem composer, sem ações de posse e sem os
 * enriquecimentos de cobrança (chat_debtor_context / chat_motor_history não
 * fazem sentido para lead de vendas). Realtime da thread vem de graça do
 * ThreadClient (canal por conversa).
 */
export default async function VendasThreadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: convRaw, error: convErr } = await supabase
    .from('conversations')
    .select(
      `
        id, unit_id, status, routing, handoff_reason, priority,
        last_inbound_at, customer_window_expires_at, assigned_operator_id,
        contact:contacts(id, wa_id, name, profile, crm_external_id),
        phone:chat_phone_numbers(
          id, phone_number_id, display_phone,
          waba:wabas(id, waba_id, name)
        ),
        unit:units(id, code, name)
      `,
    )
    .eq('id', id)
    .maybeSingle()

  if (convErr) {
    console.error('[vendas/[id]] conversation lookup error', convErr)
    notFound()
  }
  if (!convRaw) notFound()

  const conversation = convRaw as unknown as ConversationView

  // Últimas 200 (desc + reverse): conversa de vendas é curta, mas se crescer
  // o monitor mostra o FINAL da conversa — não as 200 primeiras.
  const { data: messagesRaw, error: msgErr } = await supabase
    .from('messages')
    .select(
      'id, conversation_id, wa_message_id, direction, type, payload, status, error, sent_by, operator_id, created_at',
    )
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (msgErr) {
    console.error('[vendas/[id]] messages lookup error', msgErr)
  }

  const messages = ((messagesRaw ?? []) as unknown as Message[]).reverse()

  // Signed URLs de mídia (mesma mecânica da thread da inbox).
  const PENDING_WINDOW_MS = 2 * 60 * 1000
  const now = Date.now()
  const mediaUrlMap: Record<string, { url: string | null; pending: boolean }> =
    {}
  for (const m of messages) {
    const info = extractMediaInfo(m.payload, m.type)
    if (!info) continue
    const sub = (m.payload as Record<string, unknown> | null)?.[m.type] as
      | { storage_path?: string }
      | undefined
    const ageMs = now - new Date(m.created_at).getTime()
    if (!sub?.storage_path) {
      mediaUrlMap[m.id] = { url: null, pending: ageMs < PENDING_WINDOW_MS }
      continue
    }
    const url = await createMediaSignedUrl(supabase, sub.storage_path, 3600)
    mediaUrlMap[m.id] = { url, pending: false }
  }

  return (
    <ThreadPane
      initial={messages}
      conversation={conversation}
      userId={user.id}
      initialMediaUrls={mediaUrlMap}
      debtor={null}
      operatorNames={{}}
      monitor
      backHref="/vendas"
    />
  )
}
