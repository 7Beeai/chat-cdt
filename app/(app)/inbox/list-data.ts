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

/**
 * Primary navigation axis = STATE/OWNERSHIP (not reason). Multi-operator flow:
 * an attendant lives in Aguardando (claim) → Meus (work). Reason/operator are
 * secondary FILTERS layered on top (see matchesReason/matchesOperator).
 */
export type InboxTab = 'waiting' | 'mine' | 'team' | 'closed'

export const INBOX_TABS: { value: InboxTab; label: string }[] = [
  { value: 'waiting', label: 'Aguardando' },
  { value: 'mine', label: 'Meus' },
  { value: 'team', label: 'Equipe' },
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

/**
 * True (uncapped) queue counts for one unit, from the chat_inbox_vitals RPC.
 * Decoupled from the capped working set so the vitals strip + "Aguardando" tab
 * badge show the real backlog. `waiting`/`breached`/`active` mirror the client
 * definitions in matchesTab + queue-vitals.tsx (see migration 0014).
 */
export type UnitVitals = {
  unit_id: string
  waiting: number
  breached: number
  active: number
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

/**
 * Tab membership by state/ownership. `currentUserId` is the auth id of the
 * logged-in operator (assigned_operator_id references auth.users).
 *
 * Hybrid exclusivity: once claimed, a conversation leaves 'waiting' for
 * everyone and shows only in the owner's 'mine' (others see it under 'team').
 */
export function matchesTab(
  c: Pick<
    ConversationListItem,
    'status' | 'routing' | 'assigned_operator_id'
  >,
  tab: InboxTab,
  currentUserId: string | null,
): boolean {
  switch (tab) {
    case 'waiting':
      return (
        c.status === 'open' &&
        c.routing !== 'ai' &&
        c.assigned_operator_id == null
      )
    case 'mine':
      return (
        c.status === 'open' &&
        c.assigned_operator_id != null &&
        c.assigned_operator_id === currentUserId
      )
    case 'team':
      return (
        c.status === 'open' &&
        c.assigned_operator_id != null &&
        c.assigned_operator_id !== currentUserId
      )
    case 'closed':
      return c.status === 'closed'
  }
}

/** Secondary filter: handoff reason ('all' = no filter). */
export function matchesReason(
  c: Pick<ConversationListItem, 'handoff_reason'>,
  reason: HandoffReason | 'all',
): boolean {
  return reason === 'all' || c.handoff_reason === reason
}

/** Secondary filter: assigned operator ('all' = no filter). */
export function matchesOperator(
  c: Pick<ConversationListItem, 'assigned_operator_id'>,
  operatorId: string | 'all',
): boolean {
  return operatorId === 'all' || c.assigned_operator_id === operatorId
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
