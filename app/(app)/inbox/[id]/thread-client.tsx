'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCheck, Clock, TriangleAlert } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

import { ComposerBar } from './composer-bar'
import type { ConversationView, Message } from './page'
import { ThreadHeader } from './thread-header'

type Props = {
  initial: Message[]
  conversation: ConversationView
  userId: string
}

export function ThreadClient({ initial, conversation, userId }: Props) {
  const [messages, setMessages] = useState<Message[]>(initial)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  // Scroll-to-bottom after layout. requestAnimationFrame gives the DOM
  // time to mount the new bubble before we measure scrollHeight.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior, block: 'end' })
    })
  }, [])

  // Initial mount: jump to the bottom without animation.
  useEffect(() => {
    scrollToBottom('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Realtime subscription scoped to this conversation.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`thread:${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const row = payload.new as Message
          setMessages((prev) => {
            // Optimistic dedup: if we already have a row with the same
            // wa_message_id (assigned after the API responded) or the same
            // id, replace it in place rather than duplicating.
            const byWaId = row.wa_message_id
              ? prev.findIndex((m) => m.wa_message_id === row.wa_message_id)
              : -1
            const byId = prev.findIndex((m) => m.id === row.id)
            const idx = byWaId !== -1 ? byWaId : byId
            if (idx !== -1) {
              const next = prev.slice()
              next[idx] = { ...prev[idx], ...row }
              return next
            }
            return [...prev, row]
          })
          scrollToBottom()
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const row = payload.new as Message
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === row.id)
            if (idx === -1) return prev
            const next = prev.slice()
            next[idx] = { ...prev[idx], ...row }
            return next
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversation.id, scrollToBottom])

  /**
   * Optimistic insertion — called by the composer immediately on submit,
   * before the API round-trip. The temp row gets a client-only id; the
   * composer later patches it with the real wa_message_id once the API
   * responds.
   */
  const appendOptimistic = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg])
    scrollToBottom()
  }, [scrollToBottom])

  /**
   * Patch a previously-optimistic row by its client temp id with the data
   * we now know (wa_message_id, server-side timestamps, status). The
   * realtime channel may have already replaced it — if so, the lookup
   * misses and we leave state alone.
   */
  const patchOptimistic = useCallback(
    (tempId: string, patch: Partial<Message>) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === tempId)
        if (idx === -1) return prev
        const next = prev.slice()
        next[idx] = { ...prev[idx], ...patch }
        return next
      })
    },
    [],
  )

  const removeOptimistic = useCallback((tempId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== tempId))
  }, [])

  const insideWindow = useMemo(() => {
    const exp = conversation.customer_window_expires_at
    if (!exp) return false
    return new Date(exp).getTime() > Date.now()
  }, [conversation.customer_window_expires_at])

  const wabaTextId = conversation.phone?.waba?.waba_id ?? null

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ThreadHeader conv={conversation} />

      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-y-auto bg-background"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-6">
          {messages.length === 0 ? (
            <div className="py-12 text-center font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Sem mensagens ainda.
            </div>
          ) : (
            messages.map((m) => (
              <MessageBubble key={m.id} msg={m} />
            ))
          )}
          <div ref={endRef} />
        </div>
      </div>

      <ComposerBar
        conversationId={conversation.id}
        insideWindow={insideWindow}
        expiresAt={conversation.customer_window_expires_at}
        wabaId={wabaTextId}
        userId={userId}
        onOptimisticAppend={appendOptimistic}
        onOptimisticPatch={patchOptimistic}
        onOptimisticDrop={removeOptimistic}
      />
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isIn = msg.direction === 'in'
  const sentByOperator = msg.sent_by === 'operator'
  const sentByAI = msg.sent_by === 'ai'

  // Differentiate three bubble flavours:
  // - inbound: secondary background, corner accent bottom-left
  // - outbound-AI: secondary + border (neutral), corner accent bottom-right
  // - outbound-operator: lime accent (protagonist), corner accent bottom-right
  const bubbleClass = cn(
    'max-w-[70%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm',
    isIn && 'bg-secondary text-foreground rounded-bl-sm',
    !isIn &&
      sentByAI &&
      'bg-secondary text-foreground border border-border rounded-br-sm',
    !isIn &&
      sentByOperator &&
      'bg-accent text-accent-foreground rounded-br-sm',
    !isIn &&
      !sentByAI &&
      !sentByOperator &&
      'bg-secondary text-foreground rounded-br-sm',
  )

  const rowClass = cn(
    'flex w-full',
    isIn ? 'justify-start' : 'justify-end',
  )

  return (
    <div className={rowClass}>
      <div
        className={cn(
          'flex max-w-[70%] flex-col gap-1',
          isIn ? 'items-start' : 'items-end',
        )}
      >
        {/* "IA" chip above outbound AI bubbles */}
        {!isIn && sentByAI && (
          <span className="inline-block rounded-full border border-accent/30 bg-accent/15 px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider text-accent">
            IA
          </span>
        )}

        <div className={bubbleClass}>{renderMessageBody(msg)}</div>

        <div
          className={cn(
            'mt-1 flex items-center gap-1 font-mono-num text-[10px] text-muted-foreground/80',
            isIn ? 'justify-start' : 'justify-end',
          )}
        >
          <span>{formatTime(msg.created_at)}</span>
          {!isIn && <StatusIcon status={msg.status} />}
        </div>
      </div>
    </div>
  )
}

function renderMessageBody(msg: Message): string {
  const payload = msg.payload as Record<string, unknown> | null
  if (!payload) return `[${msg.type}]`

  // Inbound text comes as { text: { body: '...' } }; outbound text we
  // posted with the same shape. Templates carry the template name we
  // sent; we surface that as a placeholder.
  if (msg.type === 'text') {
    const text = (payload.text as { body?: string } | undefined)?.body
    return text ?? '[mensagem vazia]'
  }
  if (msg.type === 'template') {
    const tpl = payload.template as { name?: string } | undefined
    return `[template: ${tpl?.name ?? 'desconhecido'}]`
  }
  if (msg.type === 'image') return '[imagem]'
  if (msg.type === 'audio') return '[áudio]'
  if (msg.type === 'video') return '[vídeo]'
  if (msg.type === 'document') return '[documento]'
  if (msg.type === 'interactive') return '[interativo]'
  return `[${msg.type}]`
}

function StatusIcon({ status }: { status: Message['status'] }) {
  if (status === 'pending') return <Clock className="size-3" />
  if (status === 'sent') return <Check className="size-3" />
  if (status === 'delivered') return <CheckCheck className="size-3" />
  if (status === 'read')
    return <CheckCheck className="size-3 text-sky-400" />
  if (status === 'failed')
    return <TriangleAlert className="size-3 text-destructive" />
  return null
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
