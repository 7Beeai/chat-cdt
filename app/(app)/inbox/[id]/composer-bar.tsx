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
  Paperclip,
  Send,
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
  /** ISO timestamp of when the 24h customer window closes. */
  expiresAt: string | null
  /**
   * Meta WABA id (TEXT, not internal uuid). Used by the template picker
   * to query `template_inventory.waba_id`. May be null if the
   * conversation isn't fully wired — in that case we disable templates.
   */
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

  // Re-render the soft window warning every 60s while inside the window.
  // The hard "out of window" state is provided by the parent — we only
  // need the local tick for the amber "<2h" warning.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!insideWindow) return
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [insideWindow])

  // `tick` is in deps so the memo recomputes against the wall clock even
  // though we don't read it directly.
  const remainingMs = useMemo(() => {
    if (!expiresAt) return 0
    return new Date(expiresAt).getTime() - Date.now()
  }, [expiresAt, tick])

  const showAmberWarning =
    insideWindow && remainingMs > 0 && remainingMs < TWO_HOURS_MS

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
          if (data.warning) {
            toast.warning(`Enviada, mas: ${data.warning}`)
          }
        } else if (r.status === 409) {
          // Out of 24h window — require a template instead. Drop the
          // optimistic bubble and prompt the operator.
          onOptimisticDrop(tempId)
          // Restore the text so the operator doesn't lose it.
          setText(trimmed)
          toast.error(
            'Fora da janela de 24h. Envie um template para retomar.',
          )
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
        // Refocus after a microtask so the controlled clear lands first.
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
      // Cmd/Ctrl+Enter submits. Plain Enter inserts a newline.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void onSubmit()
      }
    },
    [onSubmit],
  )

  const disabled = sending || text.trim().length === 0
  const canTemplate = wabaId !== null

  return (
    <div className="elegant-divider border-t border-border bg-card px-6 py-4">
      <form
        onSubmit={onSubmit}
        className="mx-auto flex max-w-3xl flex-col"
      >
        {!insideWindow && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertOctagon className="size-4 shrink-0" />
            <span>
              Fora da janela de 24h. Use um template aprovado para retomar a
              conversa.
            </span>
          </div>
        )}
        {showAmberWarning && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            <Clock className="size-4 shrink-0" />
            <span>
              Janela 24h expira em {formatShortRemaining(remainingMs)}.
            </span>
          </div>
        )}

        <div className="relative rounded-xl border border-border bg-secondary/40 transition-colors focus-within:border-accent/60">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={onKeyDown}
            placeholder={
              insideWindow
                ? 'Mensagem para o cliente. Ctrl+Enter para enviar.'
                : 'Janela 24h expirou — envie um template.'
            }
            rows={1}
            disabled={sending}
            className={cn(
              'block min-h-0 max-h-40 w-full resize-none border-0 bg-transparent px-4 py-3 pr-12 text-sm leading-relaxed text-foreground shadow-none outline-none placeholder:text-muted-foreground/70 focus-visible:ring-0 dark:bg-transparent',
            )}
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={disabled || !insideWindow}
            title={
              !insideWindow ? 'Fora da janela 24h' : 'Enviar (Ctrl+Enter)'
            }
            className="absolute right-2 bottom-2"
            aria-label="Enviar mensagem"
          >
            <Send />
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canTemplate}
            onClick={() => setPickerOpen(true)}
            title={
              canTemplate
                ? 'Enviar template aprovado'
                : 'WABA não configurada para esta conversa'
            }
          >
            <LayoutTemplate />
            Templates
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled
            title="Anexos em breve"
          >
            <Paperclip />
            Anexar
          </Button>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Ctrl+Enter para enviar · {text.length}/{MAX_CHARS}
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
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const rem = min % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}
