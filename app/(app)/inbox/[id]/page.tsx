import { notFound, redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { formatPersonName } from '@/lib/format/name'
import {
  createMediaSignedUrl,
  extractMediaInfo,
} from '@/lib/storage/media'

import { ThreadPane } from '@/components/inbox/thread-pane'

export const dynamic = 'force-dynamic'

/**
 * Debtor/cobrança context for the right panel. Comes from the read-only,
 * unit-scoped RPC `chat_debtor_context` (migration 0008), which returns a
 * single JSONB object — never a direct read of the n8n tables. Money fields
 * are already in REAIS (the source tables store cents) and arrive as numbers.
 */
export type DebtorPaymentLink = {
  valor: number | null
  status: string | null
  pix_copia_cola: string | null
  link: string | null
  gerado_em: string | null
  expira_em: string | null
}

export type DebtorPayment = {
  valor: number | null
  data: string | null
  forma: string | null
  baixa_realizada: boolean | null
}

export type DebtorContext = {
  matched: boolean
  /** Trilho do contato, casado por telefone+unidade (migration 0015). */
  trilho?: 'cobranca' | 'relacionamento' | null
  ambiguous?: boolean
  name?: string | null
  matricula?: string | null
  /** Último pagamento do cadastro de adimplente (só trilho relacionamento). */
  ultimo_pagamento_rel?: string | null
  valor_aberto?: number | null
  status?: string | null
  regua?: string | null
  tentativas?: number | null
  pagamento_feito?: boolean | null
  atualizado_em?: string | null
  ultimo_link?: DebtorPaymentLink | null
  ultimo_pagamento?: DebtorPayment | null
  total_pago?: number | null
  qtd_pagamentos?: number | null
}

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
  unit: { id: string; code: string; name: string } | null
}

/**
 * Substitui os {{n}} do corpo do template usando os valores de EXEMPLO do
 * template (registrados na Meta) pra inferir o que cada variável significa:
 *   - padrão de matrícula (UF + dígitos)  → matrícula real do cliente
 *   - padrão de dinheiro (1.234,56)       → ‹valor› (o valor da época do
 *     disparo só existe no n8n; mostrar o valor atual seria mentir)
 *   - texto tipo nome                     → primeiro nome real do cliente
 * Sem exemplo ou padrão desconhecido, mantém o {{n}} como está.
 */
function fillTemplateBody(
  body: string,
  example: unknown,
  debtor: DebtorContext | null,
  contactName: string | null | undefined,
): string {
  const ex = Array.isArray(example) ? (example as unknown[]) : null
  return body.replace(/\{\{(\d+)\}\}/g, (raw, nStr: string) => {
    const sample = ex?.[Number(nStr) - 1]
    if (typeof sample !== 'string') return raw
    const s = sample.trim()
    if (/^[A-Z]{2,3}\d{5,}$/.test(s)) return debtor?.matricula ?? '‹matrícula›'
    if (/^(R\$\s?)?\d{1,3}(\.\d{3})*,\d{2}$/.test(s)) return '‹valor›'
    if (/^[\p{L}][\p{L} .'-]*$/u.test(s)) {
      const first = (debtor?.name ?? contactName ?? '').trim().split(/\s+/)[0]
      return first || '‹nome›'
    }
    return raw
  })
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
        ),
        unit:units(id, code, name)
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

  let messages = (messagesRaw ?? []) as unknown as Message[]

  // Pré-gera URLs assinadas (1h) para cada mensagem com mídia. Para cada msg
  // armazenamos { url, pending }:
  //   - url: signed URL ou null
  //   - pending: true se ainda dentro da janela em que esperamos o download
  //              do webhook (msg < 2 min); false → "indisponível" definitivo.
  const PENDING_WINDOW_MS = 2 * 60 * 1000
  const now = Date.now()
  const mediaUrlMap: Record<
    string,
    { url: string | null; pending: boolean }
  > = {}
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

  // Debtor/cobrança context (read-only, unit-scoped RPC → single JSONB object).
  // Failures degrade to null — the panel shows honest conversation-only context.
  let debtor: DebtorContext | null = null
  const { data: debtorData, error: debtorErr } = await supabase.rpc(
    'chat_debtor_context',
    { p_conversation_id: id },
  )
  if (debtorErr) {
    console.error('[inbox/[id]] debtor context error', debtorErr)
  } else if (debtorData) {
    debtor = debtorData as DebtorContext
  }

  // Mesma troca da lista: o nome validado da cobrança (formatado "Primeiro
  // Último") vira o nome exibido. Tanto o header quanto o painel leem
  // conversation.contact.name, então ambos passam a mostrar o nome tratado.
  // Sem fetch extra — o debtor já foi carregado acima. Ver migration 0013.
  if (debtor?.name && conversation.contact) {
    const validated = formatPersonName(debtor.name)
    if (validated) conversation.contact.name = validated
  }

  // Templates de régua disparados pelo motor n8n (message_log/disparos_log não
  // têm conversation_id — a RPC casa por unidade+telefone e dedupa por
  // wa_message_id). Viram linhas sintéticas na timeline, somente exibição:
  // não existem em `messages`, então realtime/status updates não se aplicam.
  // Roda DEPOIS do debtor: nome/matrícula reais entram no lugar dos {{n}}.
  // Falha degrada para a timeline sem os disparos. Migration 0019.
  //
  // DESLIGADO 2026-06-10 a pedido do Victor: o message_log parou de ser
  // alimentado em 05/06 (réguas seguem disparando SEM log), então só
  // apareceriam disparos retroativos — confundiria as operadoras. Religar
  // quando o motor v2 estiver populando disparos_log, idealmente com corte
  // de data pra não puxar retroativo (ver docs/13).
  const SHOW_CADENCE_HISTORY = false
  const { data: cadenceRaw, error: cadenceErr } = SHOW_CADENCE_HISTORY
    ? await supabase.rpc('chat_cadence_history', { p_conversation_id: id })
    : { data: null, error: null }
  if (cadenceErr) {
    console.error('[inbox/[id]] cadence history error', cadenceErr)
  } else if (Array.isArray(cadenceRaw) && cadenceRaw.length > 0) {
    const VALID_STATUS = new Set(['sent', 'delivered', 'read', 'failed'])
    const synthetic: Message[] = (
      cadenceRaw as {
        id: number | string
        template_name: string
        sent_at: string
        status: string | null
        wa_message_id: string | null
        body: string | null
        example: unknown
      }[]
    )
      .filter((r) => r.sent_at)
      .map((r) => ({
        id: `mlog-${r.id}`,
        conversation_id: id,
        wa_message_id: r.wa_message_id,
        direction: 'out' as const,
        type: 'template',
        payload: {
          template: { name: r.template_name },
          body_text: r.body
            ? fillTemplateBody(
                r.body,
                r.example,
                debtor,
                conversation.contact?.name,
              )
            : null,
        },
        status: (VALID_STATUS.has(r.status ?? '')
          ? r.status
          : 'sent') as Message['status'],
        error: null,
        sent_by: 'ai' as const,
        operator_id: null,
        created_at: r.sent_at,
      }))
    messages = [...messages, ...synthetic].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
  }

  // Nomes dos operadores que enviaram nesta conversa (para a badge de autoria).
  // RLS de profiles só deixa ler o próprio perfil → via RPC SECURITY DEFINER.
  const operatorIds = Array.from(
    new Set<string>(
      [
        user.id,
        conversation.assigned_operator_id,
        ...messages.map((m) => m.operator_id),
      ].filter((x): x is string => !!x),
    ),
  )
  const operatorNames: Record<string, string> = {}
  if (operatorIds.length > 0) {
    const { data: ops, error: opsErr } = await supabase.rpc(
      'chat_operator_names',
      { p_ids: operatorIds },
    )
    if (opsErr) {
      console.error('[inbox/[id]] operator names error', opsErr)
    } else {
      for (const o of (ops ?? []) as { user_id: string; name: string | null }[]) {
        if (o.name) operatorNames[o.user_id] = o.name
      }
    }
  }

  return (
    <ThreadPane
      initial={messages}
      conversation={conversation}
      userId={user.id}
      initialMediaUrls={mediaUrlMap}
      debtor={debtor}
      operatorNames={operatorNames}
    />
  )
}
