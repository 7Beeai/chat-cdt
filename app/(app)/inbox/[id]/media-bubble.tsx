'use client'

import {
  FileText,
  FileImage,
  FileAudio,
  FileVideo,
  Download,
  Loader2,
  ImageOff,
} from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

import { AudioPlayer } from './audio-player'

type Props = {
  /** Tipo da mídia: image | audio | video | document | sticker. */
  type: string
  /** Texto da mídia (caption pra image/video/document; vazio caso não tenha). */
  caption?: string | null
  /** Nome do arquivo (só documento). */
  filename?: string | null
  /** MIME type. */
  mimeType?: string | null
  /**
   * URL assinada pronta para uso direto na tag `<img>`/`<audio>`/`<video>`/`<a>`.
   * Quando NULL, ver `pending` pra distinguir "baixando agora" vs "indisponível".
   */
  signedUrl: string | null
  /**
   * `true` → mostra spinner "Baixando..."; `false` + signedUrl null → mostra
   * "Mídia indisponível" (URL da Meta expirou, sem cópia local).
   */
  pending: boolean
}

/**
 * Bubble de mídia renderizada no thread. Cada tipo tem affordance própria:
 *   - image    → thumbnail clicável que abre em lightbox modal
 *   - sticker  → imagem pequena sem caption
 *   - video    → <video> controles nativos + poster
 *   - audio    → <audio> controles nativos
 *   - document → card com ícone + filename + tamanho + botão download
 */
export function MediaBubble({
  type,
  caption,
  filename,
  mimeType,
  signedUrl,
  pending,
}: Props) {
  if (signedUrl == null) {
    return pending ? <MediaPending type={type} /> : <MediaUnavailable type={type} />
  }

  if (type === 'image' || type === 'sticker') {
    return (
      <ImageBubble
        url={signedUrl}
        caption={type === 'image' ? caption : null}
        sticker={type === 'sticker'}
      />
    )
  }
  if (type === 'video') {
    return <VideoBubble url={signedUrl} caption={caption} />
  }
  if (type === 'audio') {
    return <AudioBubble url={signedUrl} />
  }
  if (type === 'document') {
    return (
      <DocumentBubble
        url={signedUrl}
        filename={filename}
        mimeType={mimeType}
        caption={caption}
      />
    )
  }
  return <MediaFallback type={type} />
}

function MediaPending({ type }: { type: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      <span>Baixando {labelOf(type)}...</span>
    </div>
  )
}

function MediaUnavailable({ type }: { type: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
      <ImageOff className="size-3.5" />
      <span>{labelOf(type, true)} não disponível</span>
    </div>
  )
}

function MediaFallback({ type }: { type: string }) {
  return (
    <span className="font-mono text-xs text-muted-foreground">
      [{labelOf(type)}]
    </span>
  )
}

function ImageBubble({
  url,
  caption,
  sticker = false,
}: {
  url: string
  caption?: string | null
  sticker?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'block overflow-hidden rounded-lg ring-0 outline-none transition-transform hover:scale-[0.99]',
          sticker ? 'max-w-[140px]' : 'max-w-full'
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          className={cn(
            'block h-auto w-full max-w-[320px] rounded-lg object-cover',
            sticker && 'max-w-[140px] bg-transparent'
          )}
          loading="lazy"
        />
      </button>
      {caption ? (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
          {caption}
        </p>
      ) : null}

      {open ? <Lightbox url={url} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className="max-h-full max-w-full rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

function VideoBubble({
  url,
  caption,
}: {
  url: string
  caption?: string | null
}) {
  return (
    <>
      <video
        src={url}
        controls
        preload="metadata"
        className="block max-w-[320px] rounded-lg bg-black"
      />
      {caption ? (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
          {caption}
        </p>
      ) : null}
    </>
  )
}

function AudioBubble({ url }: { url: string }) {
  return <AudioPlayer url={url} />
}

function DocumentBubble({
  url,
  filename,
  mimeType,
  caption,
}: {
  url: string
  filename?: string | null
  mimeType?: string | null
  caption?: string | null
}) {
  const displayName = filename || labelFromMime(mimeType) || 'documento'
  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download={filename ?? undefined}
        className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-sm transition-colors hover:bg-background/80"
      >
        <FileText className="size-6 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{displayName}</span>
          {mimeType ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {extLabel(mimeType)}
            </span>
          ) : null}
        </div>
        <Download className="size-4 shrink-0 text-muted-foreground" />
      </a>
      {caption ? (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
          {caption}
        </p>
      ) : null}
    </>
  )
}

function labelOf(type: string, capitalize = false): string {
  const map: Record<string, string> = {
    image: 'imagem',
    audio: 'áudio',
    video: 'vídeo',
    document: 'documento',
    sticker: 'sticker',
  }
  const v = map[type] ?? type
  return capitalize ? v.charAt(0).toUpperCase() + v.slice(1) : v
}

function labelFromMime(mime?: string | null): string | null {
  if (!mime) return null
  if (mime === 'application/pdf') return 'documento.pdf'
  return null
}

function extLabel(mime: string): string {
  if (mime === 'application/pdf') return 'pdf'
  const after = mime.split('/').pop() ?? mime
  return after
    .replace('vnd.openxmlformats-officedocument.', '')
    .replace('wordprocessingml.document', 'docx')
    .replace('spreadsheetml.sheet', 'xlsx')
    .replace('presentationml.presentation', 'pptx')
    .slice(0, 12)
}

// Re-export ícones pra uso futuro em outros lugares (sidebar de filtros, etc).
export { FileImage, FileAudio, FileVideo, FileText }
