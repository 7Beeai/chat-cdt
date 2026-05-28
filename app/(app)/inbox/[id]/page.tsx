import { notFound, redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

import { ThreadClient } from './thread-client'

export const dynamic = 'force-dynamic'

/**
 * Shape of a single message row, as we render it. Keep this in sync with
 * the columns selected below and the `chat_*` enums in docs/03-database.md.
 */
export type Message = {
  id: string
  conversation_id: string
  wa_message_id: string | null
  direction: 'in' | 'out'
  type: string
  payload: Record<string, unknown> | null
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  error: Record<string, unknown> | null
  sent_by: 'ai' | 'operator' | 'system' | 'customer'
  operator_id: string | null
  created_at: string
}

/**
 * Denormalised view of a conversation that the thread UI needs. We embed
 * the contact + phone + waba so the header/composer don't need to do
 * follow-up reads.
 */
export type ConversationView = {
  id: string
  unit_id: string
  status: 'open' | 'snoozed' | 'closed'
  routing: 'ai' | 'queued' | 'human'
  handoff_reason: 'payment_re_register' | 'cancel' | 'other_support' | null
  priority: number
  last_inbound_at: string | null
  customer_window_expires_at: string | null
  assigned_operator_id: string | null
  contact: {
    id: string
    wa_id: string
    name: string | null
    profile: Record<string, unknown> | null
    crm_external_id: string | null
  } | null
  phone: {
    id: string
    phone_number_id: string
    display_phone: string | null
    waba: {
      id: string
      waba_id: string // Meta WABA id (text) — used as FK by template_inventory
      name: string | null
    } | null
  } | null
}

export default async function ThreadPage({
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
        )
      `,
    )
    .eq('id', id)
    .maybeSingle()

  if (convErr) {
    console.error('[inbox/[id]] conversation lookup error', convErr)
    notFound()
  }
  if (!convRaw) notFound()

  // Supabase's typed return is structural — we trust the select shape.
  const conversation = convRaw as unknown as ConversationView

  const { data: messagesRaw, error: msgErr } = await supabase
    .from('messages')
    .select(
      'id, conversation_id, wa_message_id, direction, type, payload, status, error, sent_by, operator_id, created_at',
    )
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(100)

  if (msgErr) {
    console.error('[inbox/[id]] messages lookup error', msgErr)
  }

  const messages = (messagesRaw ?? []) as unknown as Message[]

  return (
    <ThreadClient
      initial={messages}
      conversation={conversation}
      userId={user.id}
    />
  )
}
