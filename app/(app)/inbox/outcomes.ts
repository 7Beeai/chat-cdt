/**
 * Close outcomes — the EXIT axis of a handoff (resolution), orthogonal to
 * handoff_reason (the ENTRY axis: why the AI escalated). Mirrors the
 * chat_close_outcome enum (migration 0011).
 */

export type CloseOutcome =
  | 'resolvido'
  | 'nao_resolvido'
  | 'fora_de_escopo'
  | 'cliente_nao_respondeu'

export const CLOSE_OUTCOMES: { value: CloseOutcome; label: string; hint: string }[] =
  [
    { value: 'resolvido', label: 'Resolvido', hint: 'Demanda atendida' },
    {
      value: 'nao_resolvido',
      label: 'Não resolvido',
      hint: 'Pendente / depende de outra área',
    },
    {
      value: 'cliente_nao_respondeu',
      label: 'Cliente não respondeu',
      hint: 'Cliente sumiu durante o atendimento',
    },
    {
      value: 'fora_de_escopo',
      label: 'Fora de escopo',
      hint: 'Engano, spam ou assunto que não tratamos',
    },
  ]

export const CLOSE_OUTCOME_LABEL: Record<CloseOutcome, string> =
  Object.fromEntries(CLOSE_OUTCOMES.map((o) => [o.value, o.label])) as Record<
    CloseOutcome,
    string
  >

/**
 * Payment methods offered when closing a "Recadastro de pagamento" handoff as
 * "resolvido" (the only context the field appears in — see close-dialog.tsx).
 * `value` is stored verbatim and mirrors the canonical cobrança vocabulary
 * (clientes_cobranca_dashboard."forma de pagamento") so the metric aligns with
 * the n8n side; `label` is the friendlier display. Stored as free text
 * (migration 0015) — extend this list without a migration. 'OUTRO' is the
 * safety escape for anything not covered.
 */
export const CLOSE_PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'CARTÃO DE CRÉDITO', label: 'Cartão de crédito' },
  { value: 'CARTÃO DE DÉBITO', label: 'Cartão de débito' },
  { value: 'DÉBITO BANCÁRIO', label: 'Débito bancário' },
  { value: 'BOLETO/CARNE', label: 'Boleto / Carnê' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CONCESSIONÁRIA ENERGIA', label: 'Concessionária de energia' },
  { value: 'DIRETO NO CARTÃO', label: 'Direto no cartão' },
  { value: 'OUTRO', label: 'Outro' },
]

/**
 * Reasons offered when closing a "Recadastro de pagamento" handoff with
 * `close_card_reregistered = false` — i.e. the card was NOT re-registered.
 * A June/2026 review found ~10 of 41 "Não" answers were actually
 * mis-classified handoffs (not a re-register case at all) and ~5 were a
 * re-register that happened but wasn't marked — hence a structured reason
 * instead of leaving the "Não" unexplained. Stored as free text (migration
 * 0023) — extend this list without a migration. 'outro' is the safety escape
 * for anything not covered.
 */
export const NO_REREGISTER_REASONS: { value: string; label: string }[] = [
  {
    value: 'nao_era_recadastro',
    label: 'Não era recadastro (pagamento já feito / cancelamento / dúvida)',
  },
  { value: 'cliente_adiou', label: 'Cliente vai recadastrar depois' },
  { value: 'outro_canal', label: 'Resolvido presencial / telefone / outro canal' },
  { value: 'ja_regular', label: 'Cartão já ativo / sem mensalidade em aberto' },
  {
    value: 'cliente_desistiu',
    label: 'Cliente desistiu / queria débito automático (indisponível)',
  },
  {
    value: 'pagou_avulso',
    label: 'Pagou a mensalidade, mas não trocou o meio recorrente',
  },
  { value: 'outro', label: 'Outro' },
]

/** Badge tone per outcome (Tailwind classes), for the closed list/chips. */
export const CLOSE_OUTCOME_TONE: Record<CloseOutcome, string> = {
  resolvido: 'bg-accent/12 text-accent border border-accent/30',
  nao_resolvido: 'bg-amber-500/12 text-amber-400 border border-amber-500/30',
  cliente_nao_respondeu:
    'bg-secondary text-muted-foreground border border-border',
  fora_de_escopo: 'bg-secondary text-muted-foreground border border-border',
}
