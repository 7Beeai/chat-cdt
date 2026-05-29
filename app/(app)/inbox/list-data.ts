/**
 * Shared types + filtering/sorting for the inbox list.
 *
 * v1 SCOPE: this workspace shows ONLY handoffs (conversations the n8n AI
 * escalated to a human). Conversations the AI is still handling (routing='ai')
 * never appear. The tabs are the handoff REASONS, plus closed handoffs.
 *
 * Filtering is CLIENT-SIDE over a working set fetched once by the layout
 * (open handoffs + recent closed handoffs, RLS-scoped to the operator's units).
 */

import type { MessagePreview } from './preview'

export type HandoffReason = 'payment_re_register' | 'other_support' | 'cancel'

/** Canonical, single-source labels for each handoff reason. */
export const HANDOFF_LABEL: Record<HandoffReason, string> = {
  payment_re_register: 'Recadastro pagamento',
  other_support: 'Suporte',
  cancel: 'Cancelamento',
}

export type InboxTab = HandoffReason | 'closed'

export const INBOX_TABS: { value: InboxTab; label: string }[] = [
  { value: 'payment_re_register', label: 'Recadastro pagamento' },
  { value: 'other_support', label: 'Suporte' },
  { value: 'cancel', label: 'Cancelamento' },
  { value: 'closed', label: 'Encerrados' },
]

export type ConversationListItem = {
  id: string
  unit_id: string | null
  status: 'open' | 'snoozed' | 'closed'
  routing: 'ai' | 'queued' | 'human'
  handoff_reason: HandoffReason | null
  priority: number
  last_inbound_at: string | null
  customer_window_expires_at: string | null
  assigned_operator_id: string | null
  contact: { id: string; wa_id: string; name: string | null } | null
  unit: { id: string; code: string; name: string } | null
  preview: MessagePreview | null
}

/** Minimal realtime row payload (no joins). */
export type ConversationRow = {
  id: string
  unit_id: string | null
  status: ConversationListItem['status']
  routing: ConversationListItem['routing']
  handoff_reason: HandoffReason | null
  priority: number
  last_inbound_at: string | null
  customer_window_expires_at: string | null
  assigned_operator_id: string | null
}

/**
 * Whether a conversation belongs to the handoff workspace at all. A handoff
 * happened (handoff_reason set) and either it's closed, or it's open and NOT
 * back in the AI's hands. Used by the realtime reducer to add/drop rows.
 */
export function isHandoffMember(
  c: Pick<ConversationListItem, 'status' | 'routing' | 'handoff_reason'>,
): boolean {
  if (!c.handoff_reason) return false
  if (c.status === 'closed') return true
  return c.status === 'open' && c.routing !== 'ai'
}

/** Tab membership (the tabs are handoff reasons + closed). */
export function matchesTab(
  c: Pick<
    ConversationListItem,
    'status' | 'routing' | 'handoff_reason'
  >,
  tab: InboxTab,
): boolean {
  if (tab === 'closed') {
    return c.status === 'closed' && c.handoff_reason != null
  }
  return (
    c.status === 'open' && c.routing !== 'ai' && c.handoff_reason === tab
  )
}

/** Default order: priority desc, then most recent activity first. */
export function sortItems(
  list: ConversationListItem[],
): ConversationListItem[] {
  return [...list].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const ta = a.last_inbound_at ? new Date(a.last_inbound_at).getTime() : 0
    const tb = b.last_inbound_at ? new Date(b.last_inbound_at).getTime() : 0
    return tb - ta
  })
}

/** Free-text search over name, phone digits, and unit name/code. */
export function matchesSearch(
  item: ConversationListItem,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const name = item.contact?.name?.toLowerCase() ?? ''
  const phone = item.contact?.wa_id ?? ''
  const unit = `${item.unit?.name ?? ''} ${item.unit?.code ?? ''}`.toLowerCase()
  return (
    name.includes(q) ||
    phone.includes(q.replace(/\D/g, '')) ||
    unit.includes(q)
  )
}
