import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

import { InboxClient, type ConversationListItem } from './inbox-client'
import { TabsBar, type InboxTab, type UnitOption } from './tabs-bar'

const VALID_TABS: InboxTab[] = ['queued', 'mine', 'all', 'closed']

type SearchParams = {
  tab?: string | string[]
  unit?: string | string[]
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab
  const tab: InboxTab = (VALID_TABS as string[]).includes(rawTab ?? '')
    ? (rawTab as InboxTab)
    : 'queued'

  const rawUnit = Array.isArray(sp.unit) ? sp.unit[0] : sp.unit
  const requestedUnitId = rawUnit && rawUnit.length > 0 ? rawUnit : null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Unidades às quais este operador tem acesso.
  // Usamos a RPC chat_my_units() (SECURITY DEFINER) porque a RLS pré-existente
  // em user_units compara user_id com auth.uid() — mas user_id aponta pra
  // profiles.id, não pra auth.uid(). Select direto retorna vazio. Ver
  // migration 0005_my_units_helper.sql.
  const { data: unitRows, error: unitsError } = await supabase.rpc(
    'chat_my_units'
  )
  if (unitsError) {
    console.error('[inbox] failed to load units', unitsError)
  }

  const units: UnitOption[] = (unitRows ?? []) as UnitOption[]

  // Defensivo: ignora ?unit= se não estiver na lista do operador.
  const effectiveUnitId =
    requestedUnitId && units.some((u) => u.id === requestedUnitId)
      ? requestedUnitId
      : null

  let q = supabase
    .from('conversations')
    .select(
      `
      id, unit_id, status, routing, handoff_reason, priority,
      last_inbound_at, customer_window_expires_at, assigned_operator_id,
      contact:contacts(id, wa_id, name),
      phone:chat_phone_numbers(display_phone)
    `
    )
    .order('priority', { ascending: false })
    .order('last_inbound_at', { ascending: false, nullsFirst: false })
    .limit(100)

  if (tab === 'queued') {
    q = q
      .eq('status', 'open')
      .in('routing', ['queued', 'human'])
      .is('assigned_operator_id', null)
  } else if (tab === 'mine') {
    q = q.eq('status', 'open').eq('assigned_operator_id', user.id)
  } else if (tab === 'all') {
    q = q.eq('status', 'open')
  } else {
    q = q.eq('status', 'closed')
  }

  if (effectiveUnitId) {
    q = q.eq('unit_id', effectiveUnitId)
  }

  const { data: convs, error } = await q

  if (error) {
    console.error('[inbox] failed to load conversations', error)
  }

  const conversations = (convs ?? []) as unknown as ConversationListItem[]

  const previewMap: Record<string, ConversationListItem['preview']> = {}
  const ids = conversations.map((c) => c.id)
  if (ids.length > 0) {
    const { data: msgs, error: msgErr } = await supabase
      .from('messages')
      .select('conversation_id, payload, direction, created_at, type')
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      .limit(ids.length * 5)

    if (msgErr) {
      console.error('[inbox] failed to load preview messages', msgErr)
    }

    for (const m of msgs ?? []) {
      if (previewMap[m.conversation_id]) continue
      previewMap[m.conversation_id] = {
        text: extractPreviewText(
          m.payload as Record<string, unknown> | null,
          m.type as string | null
        ),
        direction: m.direction as 'in' | 'out',
        createdAt: m.created_at as string,
      }
    }
  }

  const items: ConversationListItem[] = conversations.map((c) => ({
    ...c,
    preview: previewMap[c.id] ?? null,
  }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: flex shrink-0 garante que NÃO seja espremido por listas longas */}
      <header className="header-glow elegant-divider z-10 flex shrink-0 flex-col gap-3 border-b border-border bg-card/80 px-6 py-5 backdrop-blur-sm">
        <div className="relative z-10 flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-accent">
              7Bee.AI · Atendimento humano
            </span>
            <div className="flex items-center gap-2.5">
              <h1 className="gradient-text text-xl font-extrabold leading-none tracking-tight">
                Inbox
              </h1>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {items.length} {items.length === 1 ? 'conversa' : 'conversas'}
              </span>
            </div>
          </div>
        </div>
        <div className="relative z-10">
          <TabsBar
            value={tab}
            units={units}
            selectedUnitId={effectiveUnitId}
          />
        </div>
      </header>
      {/* min-h-0 no wrapper resolve flex bug que estourava o ScrollArea
          quando a lista era longa (218+ conversas no tab "Todos") */}
      <div className="flex min-h-0 flex-1 flex-col">
        <InboxClient initial={items} userId={user.id} tab={tab} />
      </div>
    </div>
  )
}

function extractPreviewText(
  payload: Record<string, unknown> | null,
  type: string | null
): string {
  if (!payload) return type ? `[${type}]` : ''

  const textObj = payload['text'] as { body?: unknown } | undefined
  if (textObj && typeof textObj.body === 'string') {
    return firstLine(textObj.body)
  }
  if (typeof payload['body'] === 'string') {
    return firstLine(payload['body'] as string)
  }
  for (const key of ['image', 'video', 'document', 'audio'] as const) {
    const m = payload[key] as { caption?: unknown } | undefined
    if (m && typeof m.caption === 'string' && m.caption.length > 0) {
      return firstLine(m.caption)
    }
  }
  const interactive = payload['interactive'] as
    | { button_reply?: { title?: string }; list_reply?: { title?: string } }
    | undefined
  if (interactive?.button_reply?.title) return interactive.button_reply.title
  if (interactive?.list_reply?.title) return interactive.list_reply.title

  const tpl = payload['template'] as { name?: string } | undefined
  if (tpl?.name) return `[template: ${tpl.name}]`

  return type ? `[${type}]` : ''
}

function firstLine(s: string): string {
  const trimmed = s.trim()
  const nl = trimmed.indexOf('\n')
  return nl === -1 ? trimmed : trimmed.slice(0, nl)
}
