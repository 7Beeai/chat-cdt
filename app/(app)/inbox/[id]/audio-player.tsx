'use client'

import { AlertCircle, Loader2, Pause, Play } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { cn } from '@/lib/utils'

/**
 * Player de áudio custom — substitui o `<audio controls>` nativo, que renderiza
 * inconsistente em Chrome/Firefox dark mode e quebra a identidade visual.
 *
 * Design:
 *   - `<audio>` real fica escondido; toda UI é controlada via ref + state.
 *   - Funciona neutro: o player carrega cores próprias (background escuro +
 *     accent lime) que funcionam tanto sobre o bubble `bg-card` (inbound)
 *     quanto sobre `bg-accent` (outbound do operador), porque ele tem seu
 *     próprio container `bg-background/60`.
 *   - Scrubber clicável e arrastável via pointer events (mouse + touch).
 *
 * Estados:
 *   - loading: metadata ainda baixando → spinner no botão
 *   - playing: ícone pause + leve pulse-ring no botão
 *   - error: URL expirada/falha de rede → cartão de erro simples
 *
 * Limitações conhecidas:
 *   - Safari iOS <17 não toca opus/ogg. Acima de 17, OK. Não emulamos.
 *   - URLs assinadas do Supabase Storage expiram em 1h; se o usuário deixar
 *     a aba aberta e tentar tocar depois, mostramos o estado de erro.
 */
export function AudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const sliderId = useId()

  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isScrubbing, setIsScrubbing] = useState(false)

  // Sincroniza state ↔ elemento <audio>.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoaded = () => {
      // Alguns servidores não mandam duration no metadata (chunked opus).
      // Nesse caso `duration` vem Infinity; tratamos como "indeterminado".
      const d = audio.duration
      setDuration(Number.isFinite(d) && d > 0 ? d : 0)
      setIsLoading(false)
    }
    const onTime = () => {
      if (!isScrubbing) setCurrentTime(audio.currentTime)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }
    const onError = () => {
      setHasError(true)
      setIsLoading(false)
      setIsPlaying(false)
    }
    const onWaiting = () => setIsLoading(true)
    const onPlaying = () => setIsLoading(false)

    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('durationchange', onLoaded)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('playing', onPlaying)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('durationchange', onLoaded)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('playing', onPlaying)
    }
  }, [isScrubbing])

  // Reset ao trocar a URL (signed URL nova quando refresh).
  useEffect(() => {
    setIsPlaying(false)
    setIsLoading(true)
    setHasError(false)
    setCurrentTime(0)
    setDuration(0)
  }, [url])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || hasError) return
    if (audio.paused) {
      const p = audio.play()
      // play() retorna Promise; capturamos pra não logar Uncaught.
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          setHasError(true)
          setIsPlaying(false)
        })
      }
    } else {
      audio.pause()
    }
  }, [hasError])

  // Scrubber: dado um clientX, retorna o segundo correspondente.
  const seekFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      const audio = audioRef.current
      if (!track || !audio || !duration) return
      const rect = track.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      const next = ratio * duration
      audio.currentTime = next
      setCurrentTime(next)
    },
    [duration],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return
    e.preventDefault()
    setIsScrubbing(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    seekFromPointer(e.clientX)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return
    seekFromPointer(e.clientX)
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return
    setIsScrubbing(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* já liberado */
    }
  }

  // Erro: cartão neutro com retry implícito (clicar tenta tocar de novo).
  if (hasError) {
    return (
      <div className="flex min-w-[220px] items-center gap-2.5 rounded-xl border border-destructive/30 bg-background/60 px-3 py-2.5 text-xs text-destructive">
        <AlertCircle className="size-4 shrink-0" />
        <span>Áudio indisponível</span>
      </div>
    )
  }

  const ratio = duration > 0 ? Math.min(1, currentTime / duration) : 0
  const displayDuration = duration > 0 ? duration : 0

  return (
    <div className="flex min-w-[240px] max-w-[320px] items-center gap-3 rounded-xl bg-background/60 px-2.5 py-2 backdrop-blur-sm">
      {/* <audio> real, controlado via ref. preload=metadata pra não baixar
          o arquivo inteiro até o usuário apertar play. */}
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />

      {/* Botão play/pause — circular, accent lime. */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pausar áudio' : 'Tocar áudio'}
        aria-controls={sliderId}
        className={cn(
          'relative grid size-9 shrink-0 place-items-center rounded-full',
          'bg-accent text-accent-foreground',
          'transition-all duration-150 ease-out',
          'hover:scale-[1.04] hover:brightness-110',
          'active:scale-95',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isPlaying && 'shadow-[0_0_0_3px_hsl(83_79%_60%/0.18)]',
        )}
      >
        {isLoading && !isPlaying ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isPlaying ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 translate-x-[1px] fill-current" />
        )}
      </button>

      {/* Track + tempo, em coluna. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          ref={trackRef}
          id={sliderId}
          role="slider"
          aria-label="Posição do áudio"
          aria-valuemin={0}
          aria-valuemax={displayDuration}
          aria-valuenow={currentTime}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(e) => {
            const audio = audioRef.current
            if (!audio || !duration) return
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              audio.currentTime = Math.min(duration, audio.currentTime + 5)
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault()
              audio.currentTime = Math.max(0, audio.currentTime - 5)
            } else if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              togglePlay()
            }
          }}
          className={cn(
            'group/track relative h-1.5 w-full cursor-pointer rounded-full',
            'bg-foreground/15',
            'touch-none select-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {/* Fill — barra preenchida. Sem transição quando scrubbing pra
              não dar lag visual. */}
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full bg-accent',
              !isScrubbing && 'transition-[width] duration-100 ease-linear',
            )}
            style={{ width: `${ratio * 100}%` }}
          />
          {/* Thumb — bolinha visível, expandindo em hover/scrubbing. */}
          <div
            className={cn(
              'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-md',
              'transition-transform duration-150',
              'group-hover/track:scale-110',
              isScrubbing && 'scale-125',
            )}
            style={{ left: `${ratio * 100}%` }}
          />
          {isLoading && duration === 0 ? (
            // Indeterminado: pulse sobre a track inteira enquanto metadata
            // ainda não chegou. Mantém a layout estável (sem keyframes custom).
            <div className="absolute inset-0 animate-pulse rounded-full bg-foreground/10" />
          ) : null}
        </div>

        {/* Tempo mono-num. */}
        <div className="flex items-center justify-between font-mono-num text-[10.5px] leading-none text-muted-foreground tabular-nums">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(displayDuration)}</span>
        </div>
      </div>
    </div>
  )
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
