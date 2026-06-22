'use client'

import { Loader2, Mic, RotateCcw, SendHorizontal, Square, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { AudioPlayer } from './audio-player'
import type { AudioRecording, RecorderState } from './use-audio-recorder'

type Props = {
  state: RecorderState
  elapsedMs: number
  recording: AudioRecording | null
  /** Envio em curso (após clicar Enviar no preview). */
  sending: boolean
  onStop: () => void
  onCancel: () => void
  onReRecord: () => void
  onSend: () => void
}

/**
 * Barra que substitui o input normal enquanto há gravação em curso ou um
 * preview aguardando decisão. Estados:
 *   requesting → "Permitir microfone…"
 *   recording  → ponto pulsante + timer + parar
 *   encoding   → "Processando…"
 *   preview    → AudioPlayer + Regravar / Cancelar / Enviar
 */
export function AudioRecorderBar({
  state,
  elapsedMs,
  recording,
  sending,
  onStop,
  onCancel,
  onReRecord,
  onSend,
}: Props) {
  if (state === 'preview' && recording) {
    return (
      <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-secondary/40 px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
            <Mic className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <AudioPlayer url={recording.url} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={sending}
            onClick={onReRecord}
            className="text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
            Regravar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={sending}
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={sending}
            onClick={onSend}
            className="active:scale-95"
          >
            {sending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <SendHorizontal className="size-3.5" />
            )}
            Enviar áudio
          </Button>
        </div>
      </div>
    )
  }

  // requesting | recording | encoding
  const isRecording = state === 'recording'
  const isEncoding = state === 'encoding'
  const isRequesting = state === 'requesting'

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-secondary/40 px-3 py-2.5">
      {/* Cancelar (descarta) — some no encoding (já não há o que cancelar). */}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={isEncoding}
        onClick={onCancel}
        title="Cancelar gravação"
        aria-label="Cancelar gravação"
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <X />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {isRecording ? (
          <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.18)]" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className="truncate text-[13.5px] text-foreground">
          {isRequesting && 'Permitir acesso ao microfone…'}
          {isRecording && 'Gravando áudio…'}
          {isEncoding && 'Processando…'}
        </span>
        {isRecording && (
          <span className="ml-auto font-mono-num text-[13px] tabular-nums text-muted-foreground">
            {formatTimer(elapsedMs)}
          </span>
        )}
      </div>

      {/* Parar → vai pro preview. Só durante a gravação. */}
      {isRecording && (
        <Button
          type="button"
          size="icon-sm"
          onClick={onStop}
          title="Parar gravação"
          aria-label="Parar gravação"
          className={cn('shrink-0 active:scale-90')}
        >
          <Square className="fill-current" />
        </Button>
      )}
    </div>
  )
}

function formatTimer(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
