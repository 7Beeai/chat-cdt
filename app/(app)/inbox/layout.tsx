import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { formatPersonName } from '@/lib/format/name'

import { InboxWorkspace } from '@/components/inbox/inbox-workspace'
import type { ConversationListItem, UnitVitals } from './list-data'
import { extractPreview } from './preview'

export const dynamic = 'force-dynamic'

/**
 * Inbox shell. Renders the persistent triage list (left) alongside the thread
 * region ({children}). The list stays mounted across row clicks — only the
 * thread/context area swaps — which is the whole point of the 4-column layout.
 *
 * The working set (all open + recent closed, RLS-scoped to the operator's
 * units) is fetched ONCE here; the client workspace filters by tab/unit/search
 * with no further server round-trips.
 */
export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const selectCols = `
    id, unit_id, status, routing, handoff_reason, priority,
    last_inbound_at, customer_window_expires_at, assigned_operator_id,
    contact:contacts(id, wa_id, name),
    unit:units(id, code, name)
  `

  // Cancelamento foi removido do sistema (2026-06-08): não é mais motivo de
  // handoff, então nenhuma conversa de cancelamento aparece na inbox.
  // Encerrados antigos ficam ocultos: operadores só veem encerramentos a partir
  // deste corte. O histórico continua no banco — é apenas filtro de exibição.
  const HIDE_CLOSED_BEFORE = '2026-06-08T15:55:38Z'

  // v1 mostra SÓ handoffs. Conversas que a IA está tocando (routing='ai') não
  // entram. Abertas em fila/atendimento humano:
  const { data: openRows, error: openErr } = await supabase
    .from('conversations')
    .select(selectCols)
    .eq('status', 'open')
    .in('routing', ['queued', 'human'])
    .not('handoff_reason', 'is', null)
    .neq('handoff_reason', 'cancel')
    .order('priority', { ascending: false })
    .order('last_inbound_at', { ascending: false, nullsFirst: false })
    .limit(1000)
  if (openErr) console.error('[inbox] open handoffs fetch failed', openErr)

  // Encerrados: só handoffs encerrados (com motivo) — exclui auto-fechados da IA.
  // Corte por data esconde o backlog antigo; cancelamento nunca aparece.
  const { data: closedRows, error: closedErr } = await supabase
    .from('conversations')
    .select(selectCols)
    .eq('status', 'closed')
    .not('handoff_reason', 'is', null)
    .neq('handoff_reason', 'cancel')
    .gte('closed_at', HIDE_CLOSED_BEFORE)
    .order('last_inbound_at', { ascending: false, nullsFirst: false })
    .limit(200)
  if (closedErr) console.error('[inbox] closed handoffs fetch failed', closedErr)

  const conversations = [
    ...((openRows ?? []) as unknown as ConversationListItem[]),
    ...((closedRows ?? []) as unknown as ConversationListItem[]),
  ]

  // One messages query for previews across the whole working set.
  const ids = conversations.map((c) => c.id)
  const previewMap: Record<string, ConversationListItem['preview']> = {}
  if (ids.length > 0) {
    const { data: msgs, error: msgErr } = await supabase
      .from('messages')
      .select('conversation_id, payload, direction, created_at, type')
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      .limit(ids.length * 4)
    if (msgErr) console.error('[inbox] preview fetch failed', msgErr)

    for (const m of msgs ?? []) {
      if (previewMap[m.conversation_id]) continue
      const { text, kind } = extractPreview(
        m.payload as Record<string, unknown> | null,
        m.type as string | null,
      )
      previewMap[m.conversation_id] = {
        text,
        kind,
        direction: m.direction as 'in' | 'out',
        createdAt: m.created_at as string,
      }
    }
  }

  const items: ConversationListItem[] = conversations.map((c) => ({
    ...c,
    preview: previewMap[c.id] ?? null,
  }))

  // Substitui o nome exibido pelo nome VALIDADO da base de cobrança (formatado
  // "Primeiro Último") quando há match — o nome do perfil do WhatsApp costuma
  // ser emoji/apelido/lixo. Lote único, RLS-scoped, e a busca client-side já
  // passa a casar pelo nome validado (filtra por contact.name). Falha degrada
  // para o nome do WhatsApp. Ver migration 0013.
  if (items.length > 0) {
    const { data: crmNames, error: crmErr } = await supabase.rpc(
      'chat_debtor_names',
      { p_conversation_ids: items.map((c) => c.id) },
    )
    if (crmErr) {
      console.error('[inbox] crm name resolution failed', crmErr)
    } else if (crmNames) {
      const byId = new Map(
        (crmNames as { conversation_id: string; name: string | null }[]).map(
          (r) => [r.conversation_id, r.name],
        ),
      )
      for (const it of items) {
        const validated = formatPersonName(byId.get(it.id))
        if (validated && it.contact) it.contact.name = validated
      }
    }
  }

  // Resolve names for every assigned operator present (owner display + the
  // operator filter). profiles RLS only exposes the own row, so we go through
  // the SECURITY DEFINER RPC chat_operator_names.
  const operatorIds = Array.from(
    new Set(
      items
        .map((c) => c.assigned_operator_id)
        .filter((x): x is string => !!x),
    ),
  )
  const operatorNames: Record<string, string> = {}
  if (operatorIds.length > 0) {
    const { data: ops, error: opsErr } = await supabase.rpc(
      'chat_operator_names',
      { p_ids: operatorIds },
    )
    if (opsErr) console.error('[inbox] operator names failed', opsErr)
    for (const o of (ops ?? []) as { user_id: string; name: string | null }[]) {
      if (o.name) operatorNames[o.user_id] = o.name
    }
  }

  // True (uncapped) per-unit queue counts. The list above is capped at 300 for
  // performance, so the client-derived vitals/tab badge would pin at the cap
  // and disagree with Relatórios. This RPC counts server-side, unscoped by the
  // limit; the client re-aggregates by the selected unit. Ver migration 0014.
  const { data: vitalsRaw, error: vitalsErr } = await supabase.rpc(
    'chat_inbox_vitals',
  )
  if (vitalsErr) console.error('[inbox] vitals fetch failed', vitalsErr)
  const vitalsByUnit = (vitalsRaw ?? []) as UnitVitals[]

  return (
    <InboxWorkspace
      initial={items}
      currentUserId={user.id}
      operatorNames={operatorNames}
      vitalsByUnit={vitalsByUnit}
      serverNow={Date.now()}
    >
      {children}
    </InboxWorkspace>
  )
}
