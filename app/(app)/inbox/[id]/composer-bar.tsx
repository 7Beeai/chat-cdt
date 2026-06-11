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
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Lock,
  Paperclip,
  SendHorizontal,
  UserCheck,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
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
  /** Primeiro nome do contato — preenche o {{1}} dos templates de retomada. */
  contactFirstName: string
  /** Set when the conversation belongs to another operator (read-only). */
  lockedBy?: string | null
  onTakeOver?: () => void
  onOptimisticAppend: (msg: Message) => void
  onOptimisticPatch: (tempId: string, patch: Partial<Message>) => void
  onOptimisticDrop: (tempId: string) => void
  /** Resolve a bolha de mídia otimista com o storage_path do response. */
  onOptimisticMediaResolved: (
    tempId: string,
    type: string,
    storagePath: string | null,
  ) => void
}

const MAX_CHARS = 4096
const TWO_HOURS_MS = 2 * 60 * 60 * 1000

// Espelho dos limites/whitelist do /api/messages/media (validação amigável
// antes do upload; o servidor revalida).
const MEDIA_ACCEPT =
  'image/jpeg,image/png,image/webp,video/mp4,audio/aac,audio/mp4,audio/mpeg,audio/ogg,application/pdf,' +
  'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
  'text/plain,text/csv'

type MediaKind = 'image' | 'video' | 'audio' | 'document'

function mediaKindOf(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

const MEDIA_LIMITS: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 25 * 1024 * 1024,
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function ComposerBar({
  conversationId,
  insideWindow,
  expiresAt,
  wabaId,
  userId,
  contactFirstName,
  lockedBy,
  onTakeOver,
  onOptimisticAppend,
  onOptimisticPatch,
  onOptimisticDrop,
  onOptimisticMediaResolved,
}: Props) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const onPickFile = useCallback((picked: File | null) => {
    if (!picked) return
    const kind = mediaKindOf(picked.type)
    const limit = MEDIA_LIMITS[kind]
    if (picked.size > limit) {
      toast.error(
        `Arquivo grande demais (${formatBytes(picked.size)}). Limite para ${kind === 'image' ? 'imagem' : kind === 'video' ? 'vídeo' : kind === 'audio' ? 'áudio' : 'documento'}: ${formatBytes(limit)}.`,
      )
      return
    }
    setFile(picked)
  }, [])

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

  const sendMedia = useCallback(
    async (picked: File, caption: string) => {
      const kind = mediaKindOf(picked.type)
      const tempId = `temp-${crypto.randomUUID()}`
      const optimistic: Message = {
        id: tempId,
        conversation_id: conversationId,
        wa_message_id: null,
        direction: 'out',
        type: kind,
        // Sem url/id no payload otimista → MediaBubble cai em "pendente"
        // (spinner) até o realtime trazer a linha real com storage_path.
        payload: {
          [kind]: {
            ...(caption && kind !== 'audio' ? { caption } : {}),
            ...(picked.name ? { filename: picked.name } : {}),
            mime_type: picked.type,
          },
        },
        status: 'pending',
        error: null,
        sent_by: 'operator',
        operator_id: userId,
        created_at: new Date().toISOString(),
      }

      onOptimisticAppend(optimistic)
      setFile(null)
      setText('')
      setSending(true)

      try {
        const fd = new FormData()
        fd.append('file', picked)
        fd.append('conversationId', conversationId)
        if (caption) fd.append('caption', caption)

        const r = await fetch('/api/messages/media', {
          method: 'POST',
          body: fd,
        })

        if (r.ok) {
          const data = (await r.json()) as {
            ok: true
            wa_message_id?: string
            storage_path?: string | null
          }
          onOptimisticPatch(tempId, {
            wa_message_id: data.wa_message_id ?? null,
            status: 'sent',
          })
          // Resolve a bolha na hora com o storage_path do response — sem
          // esperar o eco do realtime (que pode atrasar ou não chegar).
          onOptimisticMediaResolved(tempId, kind, data.storage_path ?? null)
        } else if (r.status === 409) {
          onOptimisticDrop(tempId)
          setFile(picked)
          setText(caption)
          toast.error('Fora da janela de 24h. Envie um template para retomar.')
          setPickerOpen(true)
          // A janela pode ter sido zerada server-side (Meta recusou com
          // 131047): refetch da conversa pra travar o composer ao vivo.
          router.refresh()
        } else if (r.status === 413 || r.status === 415) {
          onOptimisticDrop(tempId)
          toast.error(
            r.status === 413
              ? 'Arquivo grande demais para o WhatsApp.'
              : 'Tipo de arquivo não suportado pelo WhatsApp.',
          )
        } else {
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
          toast.error(`Falha no envio do anexo: ${detail || `erro ${r.status}`}`)
          setFile(picked)
          setText(caption)
        }
      } catch (err) {
        onOptimisticPatch(tempId, { status: 'failed' })
        toast.error(
          'Falha de rede ao enviar o anexo. ' +
            (err instanceof Error ? err.message : ''),
        )
        setFile(picked)
        setText(caption)
      } finally {
        setSending(false)
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
    },
    [
      conversationId,
      userId,
      router,
      onOptimisticAppend,
      onOptimisticPatch,
      onOptimisticDrop,
      onOptimisticMediaResolved,
    ],
  )

  const onSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      const trimmed = text.trim()
      if (sending) return
      if (file) {
        await sendMedia(file, trimmed)
        return
      }
      if (!trimmed) return

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
          router.refresh()
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
      file,
      sendMedia,
      sending,
      conversationId,
      userId,
      router,
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

  const canSend =
    !sending && insideWindow && (text.trim().length > 0 || file !== null)
  const canTemplate = wabaId !== null

  // Read-only: another operator owns this conversation. Surface who, and offer
  // to take it over (logs a 'reassigned' event server-side).
  if (lockedBy) {
    return (
      <div className="elegant-divider relative shrink-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-border bg-secondary/40 px-3.5 py-3">
          <Lock className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground">
              Em atendimento por{' '}
              <span className="text-sky-400">{lockedBy}</span>
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              Para responder, assuma o atendimento.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={onTakeOver}
            className="shrink-0"
          >
            <UserCheck className="size-3.5" />
            Assumir de {lockedBy}
          </Button>
        </div>
      </div>
    )
  }

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

        {/* Chip do anexo selecionado (o texto digitado vira a legenda) */}
        {file && (
          <div className="mb-2 flex items-center gap-2 self-start rounded-xl border border-border bg-secondary/50 px-3 py-2">
            {file.type.startsWith('image/') ? (
              <ImageIcon className="size-4 shrink-0 text-sky-400" />
            ) : (
              <FileText className="size-4 shrink-0 text-sky-400" />
            )}
            <span className="max-w-[260px] truncate text-[12.5px] text-foreground">
              {file.name}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatBytes(file.size)}
            </span>
            <button
              type="button"
              onClick={() => setFile(null)}
              aria-label="Remover anexo"
              className="ml-1 flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        <div
          className={cn(
            'group relative flex items-end gap-2 rounded-2xl border border-border bg-secondary/40 px-2 py-1.5 transition-colors',
            'focus-within:border-accent/60 focus-within:bg-secondary/60',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            className="hidden"
            onChange={(e) => {
              onPickFile(e.target.files?.[0] ?? null)
              e.target.value = '' // permite re-selecionar o mesmo arquivo
            }}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={!insideWindow || sending}
            onClick={() => fileInputRef.current?.click()}
            className="mb-1 shrink-0 text-muted-foreground/80 hover:text-foreground"
            title={
              insideWindow
                ? 'Anexar imagem ou documento'
                : 'Anexos só dentro da janela de 24h'
            }
            aria-label="Anexar arquivo"
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
              !insideWindow
                ? 'Janela 24h expirou — clique no ícone de templates.'
                : file
                  ? 'Legenda do anexo (opcional). Enter envia.'
                  : 'Mensagem para o cliente. Enter envia · Shift+Enter quebra linha.'
            }
            rows={1}
            // Fora da janela o campo TRAVA (não só o envio) — operador
            // limitado não fica "conversando com ninguém". O caminho fora da
            // janela é o botão de templates, que permanece ativo.
            disabled={!insideWindow || sending}
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
          contactFirstName={contactFirstName}
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
