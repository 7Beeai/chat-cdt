/**
 * Área de Vendas — types + filtros da lista.
 *
 * Diferente da inbox (que só mostra handoffs), aqui aparecem TODAS as
 * conversas dos números de VENDAS (Josi) — inclusive, principalmente, as que
 * a IA está conduzindo ao vivo (routing='ai'). É um monitor somente leitura.
 *
 * Classificador de pertencimento: conversations.phone_number_id (uuid) ∈
 * chat_vendas_phone_rows() com vendas_ativo=true (migration 0026). O filtro
 * por ativo exclui Formiga hoje: o número dela é compartilhado com
 * cobrança/relacionamento e a vendas está desligada — sem o filtro, conversas
 * de cobrança vazariam para cá.
 */

import type { MessagePreview } from '../inbox/preview'

/** Estados do funil (CHECK de vendas_leads.estado, PLANO-VENDAS-V2 §2). */
export type VendasEstado =
  | 'NOVO'
  | 'ATENDENDO'
  | 'OFERTA'
  | 'LINK_ENVIADO'
  | 'CONCLUIDO_DECLARADO'
  | 'CONFIRMADO'
  | 'POS_VENDA'
  | 'PERDIDO'

export const ESTADO_LABEL: Record<VendasEstado, string> = {
  NOVO: 'Novo',
  ATENDENDO: 'Atendendo',
  OFERTA: 'Oferta',
  LINK_ENVIADO: 'Link enviado',
  CONCLUIDO_DECLARADO: 'Concluiu (declarado)',
  CONFIRMADO: 'Confirmado',
  POS_VENDA: 'Pós-venda',
  PERDIDO: 'Perdido',
}

export const ESTADO_TONE: Record<VendasEstado, string> = {
  NOVO: 'bg-secondary text-muted-foreground border border-border',
  ATENDENDO: 'bg-sky-500/12 text-sky-400 border border-sky-500/30',
  OFERTA: 'bg-violet-500/12 text-violet-400 border border-violet-500/30',
  LINK_ENVIADO: 'bg-amber-500/12 text-amber-400 border border-amber-500/30',
  CONCLUIDO_DECLARADO:
    'bg-emerald-500/12 text-emerald-400 border border-emerald-500/30',
  CONFIRMADO: 'bg-emerald-500/18 text-emerald-300 border border-emerald-500/40',
  POS_VENDA: 'bg-teal-500/12 text-teal-400 border border-teal-500/30',
  PERDIDO: 'bg-red-500/12 text-red-400 border border-red-500/30',
}

/**
 * Eixo primário = quem está com a bola: IA ao vivo (o coração da área),
 * conversas que caíram para humano (ai_no_response/handoff) e encerradas.
 */
export type VendasTab = 'ia' | 'humano' | 'encerradas' | 'todas'

export const VENDAS_TABS: { value: VendasTab; label: string }[] = [
  { value: 'ia', label: 'IA ao vivo' },
  { value: 'humano', label: 'Com humano' },
  { value: 'encerradas', label: 'Encerradas' },
  { value: 'todas', label: 'Todas' },
]

export type VendasListItem = {
  id: string
  unit_id: string | null
  status: 'open' | 'snoozed' | 'closed'
  routing: 'ai' | 'queued' | 'human'
  handoff_reason: string | null
  priority: number
  last_inbound_at: string | null
  customer_window_expires_at: string | null
  assigned_operator_id: string | null
  /** uuid da linha em chat_phone_numbers — o classificador da área. */
  phone_number_id: string | null
  contact: { id: string; wa_id: string; name: string | null } | null
  unit: { id: string; code: string; name: string } | null
  preview: MessagePreview | null
  /** Estado do funil (vendas_leads), resolvido em lote no layout. */
  estado?: VendasEstado | null
}

/** Payload mínimo do realtime (linha crua, sem joins). */
export type VendasConversationRow = {
  id: string
  unit_id: string | null
  status: VendasListItem['status']
  routing: VendasListItem['routing']
  handoff_reason: string | null
  priority: number
  last_inbound_at: string | null
  customer_window_expires_at: string | null
  assigned_operator_id: string | null
  phone_number_id: string | null
}

export function matchesVendasTab(
  c: Pick<VendasListItem, 'status' | 'routing'>,
  tab: VendasTab,
): boolean {
  switch (tab) {
    case 'ia':
      return c.status === 'open' && c.routing === 'ai'
    case 'humano':
      return c.status === 'open' && c.routing !== 'ai'
    case 'encerradas':
      return c.status === 'closed'
    case 'todas':
      return true
  }
}

/**
 * Última atividade da conversa: o preview acompanha QUALQUER mensagem
 * (inclusive as da Josi), enquanto last_inbound_at só anda com o cliente.
 * O monitor ordena pelo que aconteceu por último, seja de quem for.
 */
export function lastActivityOf(c: VendasListItem): number {
  const prev = c.preview?.createdAt ? new Date(c.preview.createdAt).getTime() : 0
  const inb = c.last_inbound_at ? new Date(c.last_inbound_at).getTime() : 0
  return Math.max(prev, inb)
}

export function sortVendas(list: VendasListItem[]): VendasListItem[] {
  return [...list].sort((a, b) => lastActivityOf(b) - lastActivityOf(a))
}

/** lowercase + sem acentos (mesma dobra da inbox). */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function matchesVendasSearch(
  item: VendasListItem,
  query: string,
): boolean {
  const q = fold(query.trim())
  if (!q) return true
  const name = fold(item.contact?.name ?? '')
  const phone = item.contact?.wa_id ?? ''
  const unit = fold(`${item.unit?.name ?? ''} ${item.unit?.code ?? ''}`)
  const digits = q.replace(/\D/g, '')
  return (
    name.includes(q) ||
    (digits.length > 0 && phone.includes(digits)) ||
    unit.includes(q)
  )
}
