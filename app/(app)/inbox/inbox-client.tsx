'use client'

import { Inbox as InboxIcon } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { createClient } from '@/lib/supabase/client'

import { InboxRow } from './inbox-row'
import type { InboxTab } from './tabs-bar'

export type ConversationListItem = {
  id: string
  unit_id: string | null
  status: 'open' | 'snoozed' | 'closed'
  routing: 'ai' | 'queued' | 'human'
  handoff_reason: 'payment_re_register' | 'cancel' | 'other_support' | null
  priority: number
  last_inbound_at: string | null
  customer_window_expires_at: string | null
  assigned_operator_id: string | null
  contact: { id: string; wa_id: string; name: string | null } | null
  phone: { display_phone: string | null } | null
  unit: { id: string; code: string; name: string } | null
  preview: {
    text: string
    direction: 'in' | 'out'
    createdAt: string
  } | null
}

type ConversationRow = {
  id: string
  unit_id: string | null
  status: 'open' | 'snoozed' | 'closed'
  routing: 'ai' | 'queued' | 'human'
  handoff_reason: 'payment_re_register' | 'cancel' | 'other_support' | null
  priority: number
  last_inbound_at: string | null
  customer_window_expires_at: string | null
  assigned_operator_id: string | null
}

type MessageRow = {
  id: string
  conversation_id: string
  payload: Record<string, unknown> | null
  direction: 'in' | 'out'
  created_at: string
  type: string | null
}

function matchesTab(
  row: ConversationRow,
  tab: InboxTab,
  userId: string
): boolean {
  if (tab === 'queued') {
    return (
      row.status === 'open' &&
      (row.routing === 'queued' || row.routing === 'human') &&
      row.assigned_operator_id === null
    )
  }
  if (tab === 'mine') {
    return row.status === 'open' && row.assigned_operator_id === userId
  }
  if (tab === 'all') {
    return row.status === 'open'
  }
  return row.status === 'closed'
}

function sortItems(list: ConversationListItem[]): ConversationListItem[] {
  return [...list].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const ta = a.last_inbound_at ? new Date(a.last_inbound_at).getTime() : 0
    const tb = b.last_inbound_at ? new Date(b.last_inbound_at).getTime() : 0
    return tb - ta
  })
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

export function InboxClient({
  initial,
  userId,
  tab,
}: {
  initial: ConversationListItem[]
  userId: string
  tab: InboxTab
}) {
  const [items, setItems] = useState<ConversationListItem[]>(initial)
  const pathname = usePathname()

  // Reset state whenever the server-rendered initial set changes (tab switch / nav).
  useEffect(() => {
    setItems(initial)
  }, [initial])

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('inbox')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'
          const next = payload.new as ConversationRow | null
          const old = payload.old as { id?: string } | null

          if (eventType === 'DELETE') {
            if (!old?.id) return
            setItems((curr) => curr.filter((c) => c.id !== old.id))
            return
          }

          if (!next) return

          setItems((curr) => {
            const idx = curr.findIndex((c) => c.id === next.id)
            const stillMatches = matchesTab(next, tab, userId)

            if (idx === -1) {
              if (!stillMatches) return curr
              // INSERT or first time we see it in this tab: append a stub.
              // RLS-side SELECT could have hidden it before; we don't have
              // contact/phone here, so render minimal info until the next
              // navigation refreshes the server data.
              const stub: ConversationListItem = {
                id: next.id,
                unit_id: next.unit_id,
                status: next.status,
                routing: next.routing,
                handoff_reason: next.handoff_reason,
                priority: next.priority,
                last_inbound_at: next.last_inbound_at,
                customer_window_expires_at: next.customer_window_expires_at,
                assigned_operator_id: next.assigned_operator_id,
                contact: null,
                phone: null,
                // Realtime payload doesn't include joined unit metadata.
                // The row degrades gracefully (badge uses unit_id as seed
                // and falls back to "—" label). Next nav refreshes server data.
                unit: null,
                preview: null,
              }
              return sortItems([stub, ...curr])
            }

            if (!stillMatches) {
              return curr.filter((c) => c.id !== next.id)
            }

            // unit_id never changes after creation — preserve joined `unit`
            // from existing row so badge keeps its label/color.
            const merged: ConversationListItem = {
              ...curr[idx],
              status: next.status,
              routing: next.routing,
              handoff_reason: next.handoff_reason,
              priority: next.priority,
              last_inbound_at: next.last_inbound_at,
              customer_window_expires_at: next.customer_window_expires_at,
              assigned_operator_id: next.assigned_operator_id,
            }
            const copy = [...curr]
            copy[idx] = merged
            return sortItems(copy)
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as MessageRow | null
          if (!msg) return

          setItems((curr) => {
            const idx = curr.findIndex((c) => c.id === msg.conversation_id)
            if (idx === -1) return curr

            const text = extractPreviewText(msg.payload, msg.type)
            const updated: ConversationListItem = {
              ...curr[idx],
              preview: {
                text,
                direction: msg.direction,
                createdAt: msg.created_at,
              },
              // Inbound message bumps last_inbound_at so the row moves to top.
              last_inbound_at:
                msg.direction === 'in'
                  ? msg.created_at
                  : curr[idx].last_inbound_at,
            }
            const copy = [...curr]
            copy[idx] = updated
            return sortItems(copy)
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tab, userId])

  const empty = useMemo(() => items.length === 0, [items.length])

  if (empty) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-16">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div
            className="flex size-12 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground"
            aria-hidden
          >
            <InboxIcon className="size-5" />
          </div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
            Caixa de entrada
          </p>
          <p className="text-sm text-muted-foreground">
            Nada por enquanto. Você verá conversas aqui quando a IA pedir
            handoff.
          </p>
        </div>
      </div>
    )
  }

  // min-h-0 + flex-1 resolve o bug do flex em que listas grandes
  // (tab "Todos" com 218+ conversas) empurravam o header pra fora.
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="flex flex-col">
        {items.map((c) => (
          <li key={c.id}>
            <InboxRow
              conv={c}
              isActive={pathname === `/inbox/${c.id}`}
            />
          </li>
        ))}
      </ul>
    </ScrollArea>
  )
}
