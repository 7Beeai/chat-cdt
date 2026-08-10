import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

import { VendasWorkspace } from '@/components/vendas/vendas-workspace'
import type { VendasEstado, VendasListItem } from './list-data'
import { extractPreview } from '../inbox/preview'

export const dynamic = 'force-dynamic'

/**
 * Shell da Área de Vendas. Mesma anatomia da inbox (lista persistente à
 * esquerda + thread à direita), mas o working set são TODAS as conversas dos
 * números de VENDAS — a IA conduzindo (routing='ai') é o caso principal, não
 * a exceção. RLS-scoped: cada operador só vê as unidades dele.
 */
export default async function VendasLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Quais linhas de chat_phone_numbers são números de vendas (migration 0026).
  // vendas_ativo=false fica fora (hoje: Formiga, número compartilhado com
  // cobrança — ver list-data.ts).
  const { data: phonesRaw, error: phonesErr } = await supabase.rpc(
    'chat_vendas_phone_rows',
  )
  if (phonesErr) console.error('[vendas] phone rows fetch failed', phonesErr)
  const phoneRowIds = ((phonesRaw ?? []) as {
    phone_row_id: string
    vendas_ativo: boolean
  }[])
    .filter((p) => p.vendas_ativo)
    .map((p) => p.phone_row_id)

  let items: VendasListItem[] = []
  if (phoneRowIds.length > 0) {
    // ≤ 8 uuids no .in() — longe do limite de URL que derrubou a inbox
    // (aquele caso eram 600+ ids; ver migration 0019).
    const { data: convRows, error: convErr } = await supabase
      .from('conversations')
      .select(
        `
          id, unit_id, status, routing, handoff_reason, priority,
          last_inbound_at, customer_window_expires_at, assigned_operator_id,
          phone_number_id,
          contact:contacts(id, wa_id, name),
          unit:units(id, code, name)
        `,
      )
      .in('phone_number_id', phoneRowIds)
      .order('last_inbound_at', { ascending: false, nullsFirst: false })
      .limit(500)
    if (convErr) console.error('[vendas] conversations fetch failed', convErr)

    const conversations = (convRows ?? []) as unknown as VendasListItem[]
    const ids = conversations.map((c) => c.id)

    // Previews em lote (última mensagem por conversa) — RPC via POST.
    const previewMap: Record<string, VendasListItem['preview']> = {}
    if (ids.length > 0) {
      const { data: prevRows, error: prevErr } = await supabase.rpc(
        'chat_conversation_previews',
        { p_conversation_ids: ids },
      )
      if (prevErr) console.error('[vendas] preview fetch failed', prevErr)
      for (const m of (prevRows ?? []) as {
        conversation_id: string
        payload: Record<string, unknown> | null
        direction: 'in' | 'out'
        msg_type: string | null
        created_at: string
      }[]) {
        const { text, kind } = extractPreview(m.payload, m.msg_type)
        previewMap[m.conversation_id] = {
          text,
          kind,
          direction: m.direction,
          createdAt: m.created_at,
        }
      }
    }

    // Estado do funil (vendas_leads) em lote. Falha degrada para sem badge.
    const estadoMap: Record<string, VendasEstado | null> = {}
    if (ids.length > 0) {
      const { data: leadRows, error: leadErr } = await supabase.rpc(
        'chat_vendas_lead_estados',
        { p_conversation_ids: ids },
      )
      if (leadErr) console.error('[vendas] lead estados fetch failed', leadErr)
      for (const l of (leadRows ?? []) as {
        conversation_id: string
        estado: VendasEstado | null
      }[]) {
        estadoMap[l.conversation_id] = l.estado
      }
    }

    items = conversations.map((c) => ({
      ...c,
      preview: previewMap[c.id] ?? null,
      estado: estadoMap[c.id] ?? null,
    }))
  }

  return (
    <VendasWorkspace
      initial={items}
      phoneRowIds={phoneRowIds}
      serverNow={Date.now()}
    >
      {children}
    </VendasWorkspace>
  )
}
