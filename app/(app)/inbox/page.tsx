import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

import { InboxClient, type ConversationListItem } from './inbox-client'
import { TabsBar, type InboxTab } from './tabs-bar'

const VALID_TABS: InboxTab[] = ['queued', 'mine', 'all', 'closed']

type SearchParams = { tab?: string | string[] }

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

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  let q = supabase
    .from('conversations')
    .select(
      `
      id, status, routing, handoff_reason, priority,
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

  const { data: convs, error } = await q

  if (error) {
    console.error('[inbox] failed to load conversations', error)
  }

  const conversations = (convs ?? []) as unknown as ConversationListItem[]

  // Fetch a small batch of recent messages for these conversations to build previews.
  // We pull more than `ids.length` because the most recent N for each conv may overlap;
  // the JS-side group will pick the first match per conv. 100 convs × ~5 = 500 rows max.
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
    <div className="flex h-full flex-col">
      <header className="header-glow elegant-divider sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-card/80 px-6 py-5 backdrop-blur-sm">
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
          <TabsBar value={tab} />
        </div>
      </header>
      <InboxClient initial={items} userId={user.id} tab={tab} />
    </div>
  )
}

function extractPreviewText(
  payload: Record<string, unknown> | null,
  type: string | null
): string {
  if (!payload) return type ? `[${type}]` : ''

  // text messages: { text: { body } } (inbound) or { body } (outbound)
  const textObj = payload['text'] as { body?: unknown } | undefined
  if (textObj && typeof textObj.body === 'string') {
    return firstLine(textObj.body)
  }
  if (typeof payload['body'] === 'string') {
    return firstLine(payload['body'] as string)
  }
  // image/video/document with caption
  for (const key of ['image', 'video', 'document', 'audio'] as const) {
    const m = payload[key] as { caption?: unknown } | undefined
    if (m && typeof m.caption === 'string' && m.caption.length > 0) {
      return firstLine(m.caption)
    }
  }
  // interactive / button replies
  const interactive = payload['interactive'] as
    | { button_reply?: { title?: string }; list_reply?: { title?: string } }
    | undefined
  if (interactive?.button_reply?.title) return interactive.button_reply.title
  if (interactive?.list_reply?.title) return interactive.list_reply.title

  // template name fallback
  const tpl = payload['template'] as { name?: string } | undefined
  if (tpl?.name) return `[template: ${tpl.name}]`

  return type ? `[${type}]` : ''
}

function firstLine(s: string): string {
  const trimmed = s.trim()
  const nl = trimmed.indexOf('\n')
  return nl === -1 ? trimmed : trimmed.slice(0, nl)
}
