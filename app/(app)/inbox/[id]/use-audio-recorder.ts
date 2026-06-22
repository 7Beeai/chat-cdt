'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Gravação de áudio do operador → Ogg/Opus no próprio navegador (opus-recorder,
 * encoder WASM). Saímos com `audio/ogg` porque é o ÚNICO formato de voz que o
 * WhatsApp Cloud API renderiza como mensagem de voz (PTT) — o MediaRecorder
 * nativo do Chrome grava `audio/webm`, que a Meta rejeita.
 *
 * Máquina de estados:
 *   idle → requesting (pede mic) → recording → encoding → preview
 * `cancel()`/`reset()` voltam pra idle a qualquer momento; `error` carrega
 * mensagem amigável (permissão negada, sem mic, navegador sem suporte).
 *
 * O encoder é importado dinamicamente só no `start()` (1ª gravação) — não pesa
 * o bundle inicial. O worker é servido de /opus/encoderWorker.min.js (mesma
 * origem; ver scripts/copy-opus-assets.mjs).
 */

export type RecorderState =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'encoding'
  | 'preview'
  | 'error'

export type AudioRecording = {
  /** Pronto pra mandar pelo /api/messages/media (type exato `audio/ogg`). */
  file: File
  /** Object URL local pra preview no AudioPlayer. */
  url: string
  /** Duração estimada (s) — só pro chip; a real vem do <audio> metadata. */
  durationSec: number
}

// Worker do encoder, servido da mesma origem (copiado pra public/opus/).
const ENCODER_PATH = '/opus/encoderWorker.min.js'
// Bitrate do opus (voz). 16kbps mono é nítido pra fala e mantém o arquivo
// pequeno — a Meta só mostra a onda da mensagem de voz se o áudio for ≤512KB.
const ENCODER_BITRATE = 16000
// Teto de duração: a 16kbps, 4min ≈ 470KB (< 512KB), então a bolha de voz
// renderiza com play/onda em vez de virar ícone de download.
const MAX_DURATION_MS = 4 * 60 * 1000

function permissionMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Permissão de microfone negada. Libere o acesso no navegador e tente de novo.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return 'Nenhum microfone encontrado neste dispositivo.'
  if (name === 'NotReadableError')
    return 'O microfone está em uso por outro app.'
  return 'Não foi possível acessar o microfone.'
}

export function useAudioRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [recording, setRecording] = useState<AudioRecording | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // opus-recorder instance (any: tipos mínimos no .d.ts, mas guardamos via ref).
  const recorderRef = useRef<import('opus-recorder').default | null>(null)
  const chunksRef = useRef<Uint8Array[]>([])
  const startedAtRef = useRef(0)
  const finalDurationMsRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // URL do preview atual — revogada em troca/cancel/unmount pra não vazar.
  const urlRef = useRef<string | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const revokeUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  // Fecha audioContext + workers + stream do mic. Idempotente.
  const closeRecorder = useCallback(() => {
    clearTimer()
    const rec = recorderRef.current
    if (rec) {
      recorderRef.current = null
      try {
        rec.close()
      } catch {
        /* já fechado */
      }
    }
  }, [clearTimer])

  // Stop estável (sem depender de `state` no closure) — usado pelo botão e
  // pelo auto-stop do teto de duração via stopRef.
  const stop = useCallback(() => {
    clearTimer()
    const rec = recorderRef.current
    if (!rec) return
    finalDurationMsRef.current = Date.now() - startedAtRef.current
    setState('encoding')
    try {
      // dispara ondataavailable (dados finais) e depois onstop.
      rec.stop()
    } catch {
      closeRecorder()
      setState('error')
      setErrorMsg('Falha ao finalizar a gravação.')
    }
  }, [clearTimer, closeRecorder])

  const start = useCallback(async () => {
    setErrorMsg(null)
    revokeUrl()
    setRecording(null)
    chunksRef.current = []
    setElapsedMs(0)
    setState('requesting')

    try {
      const mod = await import('opus-recorder')
      const Recorder = (mod.default ?? mod) as typeof import('opus-recorder').default

      if (!Recorder.isRecordingSupported()) {
        setState('error')
        setErrorMsg('Seu navegador não suporta gravação de áudio.')
        return
      }

      const rec = new Recorder({
        encoderPath: ENCODER_PATH,
        encoderApplication: 2048, // voz (VOIP)
        encoderBitRate: ENCODER_BITRATE,
        numberOfChannels: 1, // mono
        encoderSampleRate: 48000,
        streamPages: false, // ondataavailable uma vez, com o arquivo completo
      })
      recorderRef.current = rec

      rec.ondataavailable = (data: Uint8Array) => {
        chunksRef.current.push(data)
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current as BlobPart[], {
          type: 'audio/ogg',
        })
        chunksRef.current = []
        closeRecorder()
        if (blob.size === 0) {
          setState('error')
          setErrorMsg('Gravação vazia — tente de novo.')
          return
        }
        const durationSec = Math.max(
          1,
          Math.round(finalDurationMsRef.current / 1000),
        )
        // type EXATO `audio/ogg` (sem `; codecs=opus`) — é o que o kindOf da
        // rota /api/messages/media compara no Set de MIMEs aceitos.
        const file = new File([blob], `audio-${Date.now()}.ogg`, {
          type: 'audio/ogg',
        })
        const url = URL.createObjectURL(blob)
        urlRef.current = url
        setRecording({ file, url, durationSec })
        setState('preview')
      }

      // start() PRECISA vir de gesto do usuário (clique) — senão o
      // audioContext fica suspenso / stream vazio (Safari).
      await rec.start()
      startedAtRef.current = Date.now()
      setState('recording')
      timerRef.current = setInterval(() => {
        const e = Date.now() - startedAtRef.current
        setElapsedMs(e)
        if (e >= MAX_DURATION_MS) stop()
      }, 200)
    } catch (err) {
      closeRecorder()
      setState('error')
      setErrorMsg(permissionMessage(err))
    }
  }, [revokeUrl, closeRecorder, stop])

  // Descarta tudo e volta pra idle (cancelar gravação ou preview, ou pós-envio).
  const reset = useCallback(() => {
    closeRecorder()
    chunksRef.current = []
    revokeUrl()
    setRecording(null)
    setElapsedMs(0)
    setErrorMsg(null)
    setState('idle')
  }, [closeRecorder, revokeUrl])

  // Limpeza no unmount: solta mic e revoga URL pendente.
  useEffect(() => {
    return () => {
      closeRecorder()
      revokeUrl()
    }
  }, [closeRecorder, revokeUrl])

  const isActive = state !== 'idle' && state !== 'error'

  return {
    state,
    isActive,
    elapsedMs,
    recording,
    errorMsg,
    start,
    stop,
    reset,
  }
}
