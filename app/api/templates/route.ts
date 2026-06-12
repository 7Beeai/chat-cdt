import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { graphListTemplates } from '@/lib/meta/graph'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Server-side proxy for `template_inventory`.
 *
 * Why an endpoint instead of querying directly from the browser:
 * `template_inventory` is owned by n8n and has an existing RLS policy
 * (`user_can_read_unit_code`) that depends on entries in `user_unit_permissions`.
 * CHAT-CDT operators may not be in that table (we use `user_units` for our
 * access model — see docs/03-database.md). Going through this endpoint with
 * the service-role client keeps us decoupled from the n8n permission scheme
 * without altering any policy on n8n's table.
 *
 * Access control here: only authenticated CHAT-CDT users with access to the
 * waba's unit can read the templates for that waba.
 */

const querySchema = z.object({
  waba_id: z.string().min(1),
  purpose: z.enum(['reopen']).optional(),
})

/**
 * Bases de retomada que o picker oferece. O Sentinel cria variações com
 * sufixo (`retomada_suporte_s1_1781042898`) quando a Meta reclassifica um
 * template — por isso a resolução é por PREFIXO, ficando com a variação
 * elegível mais recente de cada base. Ordem importa: recadastro_pagamento
 * antes de suporte (prefixos não são disjuntos com 'retomada_').
 */
const REOPEN_BASES = [
  {
    base: 'recadastro' as const,
    prefix: 'retomada_recadastro_pagamento',
    title: 'Retomar — Recadastro de pagamento',
  },
  {
    base: 'suporte' as const,
    prefix: 'retomada_suporte',
    title: 'Retomar atendimento — Suporte',
  },
]

type InventoryRow = {
  template_name: string
  body_text: string | null
  components: unknown
  created_at: string | null
  paused_by_sentinel: boolean | null
}

/** body_text, com fallback no componente BODY do jsonb da Meta. */
function resolveBody(row: InventoryRow): string | null {
  if (row.body_text) return row.body_text
  const comps = row.components as Array<{ type?: string; text?: string }> | null
  if (Array.isArray(comps)) {
    const body = comps.find(
      (c) => typeof c?.type === 'string' && c.type.toUpperCase() === 'BODY',
    )
    if (body?.text) return body.text
  }
  return null
}

type MetaComponents = Array<{
  type?: string
  text?: string
  buttons?: Array<{ type?: string; text?: string }>
}>

/** Textos dos quick replies do componente BUTTONS (pra UI da bolha). */
function resolveButtons(components: unknown): string[] {
  const comps = components as MetaComponents | null
  if (!Array.isArray(comps)) return []
  const btns = comps.find(
    (c) => typeof c?.type === 'string' && c.type.toUpperCase() === 'BUTTONS',
  )
  return (btns?.buttons ?? [])
    .map((b) => b?.text)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    waba_id: url.searchParams.get('waba_id') ?? '',
    purpose: url.searchParams.get('purpose') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 })
  }
  const wabaIdText = parsed.data.waba_id

  // Cookie client passes RLS — confirms user has access to this waba.
  const { data: waba, error: wErr } = await supabase
    .from('wabas')
    .select('id, unit_id')
    .eq('waba_id', wabaIdText)
    .maybeSingle()
  if (wErr) {
    console.error('[api/templates] waba lookup error', wErr)
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }
  if (!waba) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Service-role fetch from n8n's table — bypasses their RLS but only after
  // we confirmed the operator has access to the waba via our own policy.
  const svc = createServiceClient()

  // Modo retomada: só os templates de reabertura de janela, resolvidos por
  // base (variação elegível mais recente), prontos pra envio em 1 clique.
  if (parsed.data.purpose === 'reopen') {
    const { data, error } = await svc
      .from('template_inventory')
      .select('template_name, body_text, components, created_at, paused_by_sentinel')
      .eq('waba_id', wabaIdText)
      .eq('status', 'APPROVED')
      .like('template_name', 'retomada_%')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[api/templates] reopen query error', error)
      return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
    }
    const rows = (data ?? []) as InventoryRow[]
    const reopen = REOPEN_BASES.map(({ base, prefix, title }) => {
      const match = rows.find(
        (r) =>
          r.template_name.startsWith(prefix) && r.paused_by_sentinel !== true,
      )
      return {
        base,
        title,
        template_name: match?.template_name ?? null,
        body: match ? resolveBody(match) : null,
        buttons: match ? resolveButtons(match.components) : [],
      }
    })

    // Muitas linhas do inventário estão sem body_text E sem components
    // (verificado no banco em 2026-06-10). Sem o corpo, o picker não sabe
    // quantos {{n}} o template tem — e mandar a contagem errada de parâmetros
    // a Meta rejeita (132000). Fallback: resolve o corpo direto da Graph API
    // (uma chamada por abertura do picker, só quando falta).
    if (reopen.some((o) => o.template_name && !o.body)) {
      try {
        const list = (await graphListTemplates(wabaIdText)) as {
          data?: Array<{
            name?: string
            components?: Array<{ type?: string; text?: string }>
          }>
        }
        for (const o of reopen) {
          if (!o.template_name || o.body) continue
          const meta = list.data?.find((t) => t.name === o.template_name)
          const body = meta?.components?.find(
            (c) => typeof c?.type === 'string' && c.type.toUpperCase() === 'BODY',
          )
          if (body?.text) o.body = body.text
          if (o.buttons.length === 0) o.buttons = resolveButtons(meta?.components)
        }
      } catch (err) {
        console.error('[api/templates] graph body fallback failed', err)
      }
    }

    return NextResponse.json({ reopen })
  }

  const { data, error } = await svc
    .from('template_inventory')
    // template_inventory não tem coluna language; todos os templates são pt_BR
    // e o picker já usa esse fallback quando o campo vem ausente.
    .select('template_name, category, status, body_text, components, is_active_in_cadence')
    .eq('waba_id', wabaIdText)
    .eq('status', 'APPROVED')
    .order('template_name', { ascending: true })

  if (error) {
    console.error('[api/templates] template_inventory query error', error)
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 })
  }

  return NextResponse.json({ templates: data ?? [] })
}
