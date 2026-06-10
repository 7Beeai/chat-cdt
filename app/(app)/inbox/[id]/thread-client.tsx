'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Check,
  CheckCheck,
  Clock,
  TriangleAlert,
  Sparkles,
  UserRound,
} from 'lucide-react'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import { createMediaSignedUrl, extractMediaInfo } from '@/lib/storage/media'
import { dateDividerLabel, dateKey } from '@/lib/format/time'
import { cn } from '@/lib/utils'

import { takeOverConversation } from './actions'
import { ComposerBar } from './composer-bar'
import { MediaBubble } from './media-bubble'
import type { ConversationView, Message } from './page'
import { ThreadHeader } from './thread-header'

type MediaState = { url: string | null; pending: boolean }

const MEDIA_TYPES = new Set(['image', 'audio', 'video', 'document', 'sticker'])
const GROUP_WINDOW_MS = 5 * 60 * 1000

type SenderTone = 'in' | 'out-ai' | 'out-operator' | 'out-system'

type MessageGroup = {
  kind: 'messages'
  key: string
  tone: SenderTone
  messages: Message[]
}

type DateMark = {
  kind: 'date'
  key: string
  label: string
}

type ThreadItem = MessageGroup | DateMark

function toneOf(msg: Message): SenderTone {
  if (msg.direction === 'in') return 'in'
  if (msg.sent_by === 'operator') return 'out-operator'
  if (msg.sent_by === 'ai') return 'out-ai'
  return 'out-system'
}

function buildThreadItems(messages: Message[]): ThreadItem[] {
  const out: ThreadItem[] = []
  let lastDateKey = ''
  let currentGroup: MessageGroup | null = null

  for (const m of messages) {
    const dKey = dateKey(m.created_at)
    if (dKey !== lastDateKey) {
      out.push({
        kind: 'date',
        key: `date:${dKey}`,
        label: dateDividerLabel(m.created_at),
      })
      lastDateKey = dKey
      currentGroup = null
    }

    const tone = toneOf(m)
    const tMs = new Date(m.created_at).getTime()
    const last =
      currentGroup && currentGroup.messages[currentGroup.messages.length - 1]
    const withinWindow =
      last &&
      tMs - new Date(last.created_at).getTime() <= GROUP_WINDOW_MS
    const sameTone = currentGroup && currentGroup.tone === tone

    if (currentGroup && sameTone && withinWindow) {
      currentGroup.messages.push(m)
    } else {
      currentGroup = {
        kind: 'messages',
        key: `g:${m.id}`,
        tone,
        messages: [m],
      }
      out.push(currentGroup)
    }
  }
  return out
}

// ---------------------------------------------------------------------------

type Props = {
  initial: Message[]
  conversation: ConversationView
  userId: string
  initialMediaUrls: Record<string, MediaState>
  operatorNames?: Record<string, string>
  contextOpen?: boolean
  onToggleContext?: () => void
}

export function ThreadClient({
  initial,
  conversation,
  userId,
  initialMediaUrls,
  operatorNames = {},
  contextOpen,
  onToggleContext,
}: Props) {
  const [messages, setMessages] = useState<Message[]>(initial)
  const [mediaUrls, setMediaUrls] =
    useState<Record<string, MediaState>>(initialMediaUrls)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior, block: 'end' })
    })
  }, [])

  useEffect(() => {
    scrollToBottom('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          void resolveMediaUrlIfNeeded(row)
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
          void resolveMediaUrlIfNeeded(row)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }

    async function resolveMediaUrlIfNeeded(row: Message) {
      const info = extractMediaInfo(row.payload, row.type)
      if (!info) return
      const sub = (row.payload as Record<string, unknown> | null)?.[row.type] as
        | { storage_path?: string }
        | undefined
      const path = sub?.storage_path
      if (!path) {
        setMediaUrls((prev) => ({
          ...prev,
          [row.id]: prev[row.id] ?? { url: null, pending: true },
        }))
        return
      }
      if (mediaUrls[row.id]?.url) return
      const url = await createMediaSignedUrl(supabase, path, 3600)
      setMediaUrls((prev) => ({
        ...prev,
        [row.id]: { url, pending: false },
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, scrollToBottom])

  const appendOptimistic = useCallback(
    (msg: Message) => {
      setMessages((prev) => [...prev, msg])
      scrollToBottom()
    },
    [scrollToBottom],
  )

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
  const items = useMemo(() => buildThreadItems(messages), [messages])

  // Hybrid exclusivity: if the conversation belongs to ANOTHER operator, the
  // composer is read-only here (only the owner can reply) until taken over.
  const router = useRouter()
  const lockedBy =
    conversation.assigned_operator_id &&
    conversation.assigned_operator_id !== userId
      ? (operatorNames[conversation.assigned_operator_id] ?? 'outro operador')
      : null

  const handleTakeOver = useCallback(() => {
    void (async () => {
      const r = await takeOverConversation(conversation.id)
      if (r?.error) toast.error(`Assumir: ${r.error}`)
      else {
        toast.success('Atendimento assumido')
        router.refresh()
      }
    })()
  }, [conversation.id, router])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ThreadHeader
        conv={conversation}
        contextOpen={contextOpen}
        onToggleContext={onToggleContext}
      />

      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        {/* Subtle paper-like texture so o background não fica preto morto.
            Pointer-events-none deixa scroll/click passar. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, hsl(var(--foreground)) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="relative mx-auto flex max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-8">
          {items.length === 0 ? (
            <EmptyState />
          ) : (
            items.map((item) =>
              item.kind === 'date' ? (
                <DateDivider key={item.key} label={item.label} />
              ) : (
                <MessageGroupView
                  key={item.key}
                  group={item}
                  mediaUrls={mediaUrls}
                  operatorNames={operatorNames}
                />
              ),
            )
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
        lockedBy={lockedBy}
        onTakeOver={handleTakeOver}
        onOptimisticAppend={appendOptimistic}
        onOptimisticPatch={patchOptimistic}
        onOptimisticDrop={removeOptimistic}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center py-24 text-center">
      <div className="flex max-w-xs flex-col items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-secondary/50">
          <Clock className="size-5 text-muted-foreground" />
        </div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
          Conversa vazia
        </p>
        <p className="text-sm text-muted-foreground">
          Nada por aqui ainda. As mensagens aparecem em tempo real.
        </p>
      </div>
    </div>
  )
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center justify-center first:mt-0">
      <span className="rounded-full border border-border/60 bg-card/80 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground backdrop-blur-sm">
        {label}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------

function MessageGroupView({
  group,
  mediaUrls,
  operatorNames,
}: {
  group: MessageGroup
  mediaUrls: Record<string, MediaState>
  operatorNames: Record<string, string>
}) {
  const align = group.tone === 'in' ? 'items-start' : 'items-end'
  const groupGap = 'gap-[3px]' // intra-grupo: bubbles colados

  const operatorName =
    group.tone === 'out-operator'
      ? (operatorNames[group.messages[0]?.operator_id ?? ''] ?? 'Operador')
      : null

  return (
    <div className={cn('mt-4 flex flex-col first:mt-0', align, groupGap)}>
      {/* Badge de autoria no início do grupo: IA, ou nome do operador */}
      {group.tone === 'out-ai' && <AIBadge />}
      {group.tone === 'out-operator' && operatorName && (
        <OperatorBadge name={operatorName} />
      )}

      {group.messages.map((m, i) => {
        const position: BubblePosition =
          group.messages.length === 1
            ? 'only'
            : i === 0
              ? 'first'
              : i === group.messages.length - 1
                ? 'last'
                : 'middle'
        const isLastOfGroup = i === group.messages.length - 1

        return (
          <Bubble
            key={m.id}
            msg={m}
            tone={group.tone}
            position={position}
            media={mediaUrls[m.id] ?? { url: null, pending: false }}
            showTimeAndStatus={isLastOfGroup}
          />
        )
      })}
    </div>
  )
}

function AIBadge() {
  return (
    <span className="mb-0.5 inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-accent">
      <Sparkles className="size-2.5" />
      IA
    </span>
  )
}

// Mesmo padrão da badge da IA, em ciano (tom do operador), com o nome de quem enviou.
function OperatorBadge({ name }: { name: string }) {
  return (
    <span className="mb-0.5 inline-flex max-w-[200px] items-center gap-1 rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-sky-400">
      <UserRound className="size-2.5 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------

type BubblePosition = 'only' | 'first' | 'middle' | 'last'

function Bubble({
  msg,
  tone,
  position,
  media,
  showTimeAndStatus,
}: {
  msg: Message
  tone: SenderTone
  position: BubblePosition
  media: MediaState
  showTimeAndStatus: boolean
}) {
  const isIn = tone === 'in'
  const isMedia = MEDIA_TYPES.has(msg.type)

  // Cantos: pequenos quando "atachado" a um bubble vizinho do mesmo grupo,
  // ou no canto da cauda (only/last). Os demais permanecem rounded-2xl.
  const topAttached = position === 'middle' || position === 'last'
  const bottomAttached = position === 'first' || position === 'middle'
  const showTail = position === 'only' || position === 'last'
  const cornerClass = isIn
    ? cn(
        topAttached && 'rounded-tl-md',
        (bottomAttached || showTail) && 'rounded-bl-md',
      )
    : cn(
        topAttached && 'rounded-tr-md',
        (bottomAttached || showTail) && 'rounded-br-md',
      )

  // Cores por tone
  // 3 cores por remetente (harmônicas com o dark + lime):
  //   cliente → neutro · IA → lime · operador → ciano
  // Cada tom aparece na bolha E na badge correspondente.
  const bgClass = (() => {
    if (isIn) return 'bg-white/20 text-foreground border border-border/60'
    if (tone === 'out-operator')
      return 'bg-sky-400/20 text-foreground border border-sky-400/25'
    // out-ai e out-system
    return 'bg-accent/20 text-foreground border border-accent/20'
  })()

  const bubbleClass = cn(
    'group relative inline-block max-w-full break-words rounded-2xl',
    'leading-relaxed text-[15px]',
    isMedia ? 'p-1.5' : 'px-3.5 py-2',
    cornerClass,
    bgClass,
  )

  return (
    <div className="w-full max-w-[88%] sm:max-w-[78%] md:max-w-[72%]">
      <div className={cn('flex w-full', isIn ? 'justify-start' : 'justify-end')}>
        <div className={bubbleClass}>
          {isMedia ? (
            <MediaBubble
              type={msg.type}
              signedUrl={media.url}
              pending={media.pending}
              caption={extractCaption(msg)}
              filename={extractFilename(msg)}
              mimeType={extractMimeType(msg)}
            />
          ) : (
            <p className="whitespace-pre-wrap">{renderTextBody(msg)}</p>
          )}

          {/* Timestamp + status: SÓ no último bubble do grupo, dentro do
              próprio bubble (canto inferior). Para mídia, fica abaixo. */}
          {showTimeAndStatus && !isMedia && (
            <span
              className={cn(
                'ml-2 inline-flex translate-y-0.5 items-center gap-1 align-baseline font-mono-num text-[10px]',
                'text-muted-foreground/80',
              )}
            >
              {formatTime(msg.created_at)}
              {!isIn && (
                <StatusIcon status={msg.status} />
              )}
            </span>
          )}
        </div>
      </div>

      {/* Para mídia: timestamp/status fora do bubble (não cabe inline) */}
      {showTimeAndStatus && isMedia && (
        <div
          className={cn(
            'mt-1 flex items-center gap-1 font-mono-num text-[10px] text-muted-foreground/80',
            isIn ? 'justify-start' : 'justify-end',
          )}
        >
          <span>{formatTime(msg.created_at)}</span>
          {!isIn && <StatusIcon status={msg.status} />}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: Message['status'] }) {
  const muted = 'text-muted-foreground/80'

  if (status === 'pending')
    return <Clock className={cn('size-3', muted)} aria-label="pendente" />
  if (status === 'sent')
    return <Check className={cn('size-3', muted)} aria-label="enviada" />
  if (status === 'delivered')
    return (
      <CheckCheck className={cn('size-3', muted)} aria-label="entregue" />
    )
  if (status === 'read')
    return (
      <CheckCheck
        className={cn('size-3', 'text-sky-400')}
        aria-label="lida"
      />
    )
  if (status === 'failed')
    return (
      <TriangleAlert
        className="size-3 text-destructive"
        aria-label="falhou"
      />
    )
  return null
}

// ---------------------------------------------------------------------------

function renderTextBody(msg: Message): string {
  const payload = msg.payload as Record<string, unknown> | null
  if (!payload) return `[${msg.type}]`

  if (msg.type === 'text') {
    const text = (payload.text as { body?: string } | undefined)?.body
    return text ?? '[mensagem vazia]'
  }
  if (msg.type === 'template') {
    // Disparos de régua (chat_cadence_history) trazem o corpo do template
    // resolvido de template_inventory em body_text — variáveis ficam como
    // {{n}} (os valores reais só existem no n8n). Sem corpo, cai no nome.
    const body = payload.body_text
    if (typeof body === 'string' && body.length > 0) return body
    const tpl = payload.template as { name?: string } | undefined
    return `[template: ${tpl?.name ?? 'desconhecido'}]`
  }
  if (msg.type === 'button') {
    const btn = payload.button as { text?: string } | undefined
    return btn?.text ?? '[botão]'
  }
  if (msg.type === 'reaction') {
    const r = payload.reaction as { emoji?: string } | undefined
    return r?.emoji ? `Reagiu com ${r.emoji}` : '[reação]'
  }
  if (msg.type === 'interactive') {
    const inter = payload.interactive as
      | {
          button_reply?: { title?: string }
          list_reply?: { title?: string }
        }
      | undefined
    return (
      inter?.button_reply?.title ?? inter?.list_reply?.title ?? '[interativo]'
    )
  }
  return `[${msg.type}]`
}

function extractCaption(msg: Message): string | null {
  const sub = (msg.payload as Record<string, unknown> | null)?.[msg.type] as
    | { caption?: string }
    | undefined
  return sub?.caption ?? null
}

function extractFilename(msg: Message): string | null {
  const sub = (msg.payload as Record<string, unknown> | null)?.[msg.type] as
    | { filename?: string }
    | undefined
  return sub?.filename ?? null
}

function extractMimeType(msg: Message): string | null {
  const sub = (msg.payload as Record<string, unknown> | null)?.[msg.type] as
    | { mime_type?: string }
    | undefined
  return sub?.mime_type ?? null
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
