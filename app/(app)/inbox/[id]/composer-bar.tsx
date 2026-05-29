'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  AlertOctagon,
  Clock,
  LayoutTemplate,
  Loader2,
  Paperclip,
  SendHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import type { Message } from './page'
import { TemplatePicker } from './template-picker'

type Props = {
  conversationId: string
  insideWindow: boolean
  expiresAt: string | null
  wabaId: string | null
  userId: string
  onOptimisticAppend: (msg: Message) => void
  onOptimisticPatch: (tempId: string, patch: Partial<Message>) => void
  onOptimisticDrop: (tempId: string) => void
}

const MAX_CHARS = 4096
const TWO_HOURS_MS = 2 * 60 * 60 * 1000

export function ComposerBar({
  conversationId,
  insideWindow,
  expiresAt,
  wabaId,
  userId,
  onOptimisticAppend,
  onOptimisticPatch,
  onOptimisticDrop,
}: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Auto-grow do textarea conforme o usuário digita.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = 200 // ~8 linhas
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
  }, [text])

  // Tick pra re-renderizar warning amber a cada minuto enquanto dentro da janela
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!insideWindow) return
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [insideWindow])

  const remainingMs = useMemo(() => {
    if (!expiresAt) return 0
    return new Date(expiresAt).getTime() - Date.now()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt, tick])

  const showAmberWarning =
    insideWindow && remainingMs > 0 && remainingMs < TWO_HOURS_MS

  const charsLeft = MAX_CHARS - text.length
  const showCounter = charsLeft < 300 // só perto do limite

  const onSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      const trimmed = text.trim()
      if (!trimmed || sending) return

      const tempId = `temp-${crypto.randomUUID()}`
      const optimistic: Message = {
        id: tempId,
        conversation_id: conversationId,
        wa_message_id: null,
        direction: 'out',
        type: 'text',
        payload: { text: { body: trimmed, preview_url: false } },
        status: 'pending',
        error: null,
        sent_by: 'operator',
        operator_id: userId,
        created_at: new Date().toISOString(),
      }

      onOptimisticAppend(optimistic)
      setText('')
      setSending(true)

      try {
        const r = await fetch('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            type: 'text',
            text: trimmed,
          }),
        })

        if (r.ok) {
          const data = (await r.json()) as {
            ok: true
            wa_message_id?: string
            warning?: string
          }
          onOptimisticPatch(tempId, {
            wa_message_id: data.wa_message_id ?? null,
            status: 'sent',
          })
          if (data.warning) toast.warning(`Enviada, mas: ${data.warning}`)
        } else if (r.status === 409) {
          onOptimisticDrop(tempId)
          setText(trimmed)
          toast.error('Fora da janela de 24h. Envie um template para retomar.')
          setPickerOpen(true)
        } else if (r.status === 502) {
          let detail = ''
          try {
            const body = (await r.json()) as { details?: unknown }
            detail =
              typeof body?.details === 'object' && body.details
                ? JSON.stringify(body.details).slice(0, 200)
                : ''
          } catch {
            // ignore
          }
          onOptimisticPatch(tempId, { status: 'failed' })
          toast.error(`Falha no envio (Graph): ${detail || 'erro 502'}`)
          setText(trimmed)
        } else {
          onOptimisticPatch(tempId, { status: 'failed' })
          toast.error(`Falha no envio (${r.status})`)
          setText(trimmed)
        }
      } catch (err) {
        onOptimisticPatch(tempId, { status: 'failed' })
        toast.error(
          'Falha de rede ao enviar. ' +
            (err instanceof Error ? err.message : ''),
        )
        setText(trimmed)
      } finally {
        setSending(false)
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
    },
    [
      text,
      sending,
      conversationId,
      userId,
      onOptimisticAppend,
      onOptimisticPatch,
      onOptimisticDrop,
    ],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter envia, Shift+Enter nova linha (padrão moderno tipo Linear/Slack).
      // Ctrl+Enter também envia (compat com hábito antigo).
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void onSubmit()
      }
    },
    [onSubmit],
  )

  const canSend = !sending && text.trim().length > 0 && insideWindow
  const canTemplate = wabaId !== null

  return (
    <div className="elegant-divider relative shrink-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4">
      <form onSubmit={onSubmit} className="mx-auto flex max-w-3xl flex-col">
        {!insideWindow && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertOctagon className="size-4 shrink-0" />
            <span>
              Fora da janela de 24h. Use um <strong>template aprovado</strong>{' '}
              para retomar a conversa.
            </span>
          </div>
        )}
        {showAmberWarning && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            <Clock className="size-4 shrink-0" />
            <span>
              Janela de 24h expira em{' '}
              <strong>{formatShortRemaining(remainingMs)}</strong>.
            </span>
          </div>
        )}

        <div
          className={cn(
            'group relative flex items-end gap-2 rounded-2xl border border-border bg-secondary/40 px-2 py-1.5 transition-colors',
            'focus-within:border-accent/60 focus-within:bg-secondary/60',
          )}
        >
          {/* Attach button — disabled (Fase 2) */}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled
            className="mb-1 shrink-0 text-muted-foreground/60"
            title="Anexos em breve"
            aria-label="Anexar (em breve)"
          >
            <Paperclip />
          </Button>

          {/* Templates button — sempre acessível dentro da bar */}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={!canTemplate}
            onClick={() => setPickerOpen(true)}
            className="mb-1 shrink-0 text-muted-foreground/80 hover:text-foreground"
            title={
              canTemplate
                ? 'Templates aprovados'
                : 'WABA não configurada para esta conversa'
            }
            aria-label="Templates"
          >
            <LayoutTemplate />
          </Button>

          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={onKeyDown}
            placeholder={
              insideWindow
                ? 'Mensagem para o cliente. Enter envia · Shift+Enter quebra linha.'
                : 'Janela 24h expirou — clique no ícone de templates.'
            }
            rows={1}
            disabled={sending}
            className={cn(
              'block min-h-9 w-full resize-none border-0 bg-transparent px-2 py-2 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:bg-transparent',
            )}
            aria-label="Texto da mensagem"
          />

          {/* Send button - sempre visível, só muda estado */}
          <Button
            type="submit"
            size="icon-sm"
            disabled={!canSend}
            className={cn(
              'mb-1 shrink-0 transition-transform',
              canSend && 'active:scale-90',
            )}
            title={
              !insideWindow
                ? 'Fora da janela 24h'
                : sending
                  ? 'Enviando…'
                  : 'Enviar (Enter)'
            }
            aria-label="Enviar mensagem"
          >
            {sending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <SendHorizontal />
            )}
          </Button>
        </div>

        {/* Footer calmo persistente: janela Meta (esq) + atalhos (dir) */}
        <div className="mt-1.5 flex items-center justify-between gap-3 px-2 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground">
          <span>
            {insideWindow
              ? `Janela Meta · ${formatShortRemaining(remainingMs)} restantes`
              : 'Fora da janela 24h'}
          </span>
          <span className="flex items-center gap-2.5">
            {showCounter && (
              <span
                className={cn(
                  'font-mono-num normal-case',
                  charsLeft < 50 && 'text-amber-400',
                  charsLeft < 0 && 'text-destructive',
                )}
              >
                {charsLeft} restantes
              </span>
            )}
            <span>↵ enviar · ⇧↵ nova linha</span>
          </span>
        </div>
      </form>

      {canTemplate && (
        <TemplatePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          conversationId={conversationId}
          wabaId={wabaId!}
        />
      )}
    </div>
  )
}

function formatShortRemaining(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rem = min % 60
  return rem ? `${h}h ${rem} min` : `${h}h`
}
