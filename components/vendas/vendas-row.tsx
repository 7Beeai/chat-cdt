'use client'

import {
  Bot,
  FileText,
  Image as ImageIcon,
  Mic,
  Video,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties } from 'react'

import {
  ESTADO_LABEL,
  ESTADO_TONE,
  type VendasListItem,
} from '@/app/(app)/vendas/list-data'
import type { PreviewKind } from '@/app/(app)/inbox/preview'
import { formatWaId } from '@/lib/format/phone'
import { nameInitials } from '@/lib/format/name'
import { relativeTime } from '@/lib/format/time'
import { unitColor } from '@/lib/unit-colors'
import { cn } from '@/lib/utils'

const PREVIEW_ICON: Partial<Record<PreviewKind, LucideIcon>> = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: FileText,
}

function initialsOf(name: string | null | undefined, fallback: string): string {
  const ini = nameInitials(name)
  if (ini) return ini
  const digits = fallback.replace(/\D/g, '')
  return digits.length >= 2 ? digits.slice(-2) : '#'
}

/**
 * Linha do monitor de vendas. Sem seleção/bulk (a área é somente leitura):
 * identidade + unidade, estado do funil, preview da última mensagem (com
 * ícone de robô quando quem falou por último foi a Josi) e recência.
 */
export function VendasRow({
  conv,
  now,
  isActive = false,
}: {
  conv: VendasListItem
  /** Snapshot único de "agora" compartilhado pelas linhas (ver InboxRow). */
  now: number
  isActive?: boolean
}) {
  const displayName =
    conv.contact?.name?.trim() ||
    (conv.contact?.wa_id ? formatWaId(conv.contact.wa_id) : 'Desconhecido')
  const initials = initialsOf(conv.contact?.name, conv.contact?.wa_id ?? '##')

  const unitSeed = conv.unit?.id ?? conv.unit_id
  const uc = unitSeed ? unitColor(unitSeed) : null
  const avatarStyle: CSSProperties = uc
    ? { backgroundColor: uc.bg, borderColor: uc.border, color: uc.fg }
    : {}
  const unitLabel = conv.unit?.name || conv.unit?.code?.toUpperCase() || null

  const liveWithAi = conv.status === 'open' && conv.routing === 'ai'
  const withHuman = conv.status === 'open' && conv.routing !== 'ai'
  const isClosed = conv.status === 'closed'

  const preview = conv.preview
  const PreviewIcon = preview ? PREVIEW_ICON[preview.kind] : undefined
  const when = preview?.createdAt ?? conv.last_inbound_at

  const estado = conv.estado ?? null

  return (
    <Link
      href={`/vendas/${conv.id}`}
      className={cn(
        'flex w-full items-start gap-3 border-b border-border/60 px-[18px] py-3 text-left transition-colors',
        isActive ? 'bg-secondary/80' : 'hover:bg-secondary/40',
        isClosed && 'opacity-60',
      )}
    >
      <div
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[12px] font-bold"
        style={avatarStyle}
        aria-hidden
      >
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-foreground">
            {displayName}
          </span>
          {liveWithAi && (
            <span
              className="live-dot size-[6px] shrink-0 rounded-full bg-accent"
              title="IA conduzindo ao vivo"
              aria-label="IA conduzindo ao vivo"
            />
          )}
          <span className="ml-auto shrink-0 font-mono-num text-[10.5px] text-muted-foreground">
            {when ? relativeTime(when, now) : ''}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-1.5">
          {preview?.direction === 'out' && (
            <Bot
              className="size-3 shrink-0 text-accent/80"
              aria-label="Última mensagem da IA"
            />
          )}
          {PreviewIcon && (
            <PreviewIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-[12px] text-muted-foreground">
            {preview?.text || 'Sem mensagens ainda'}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {unitLabel && (
            <span
              className="inline-flex items-center rounded-full border px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.06em]"
              style={
                uc
                  ? {
                      backgroundColor: uc.bg,
                      borderColor: uc.border,
                      color: uc.fg,
                    }
                  : undefined
              }
            >
              {unitLabel}
            </span>
          )}
          {estado && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.06em]',
                ESTADO_TONE[estado] ??
                  'bg-secondary text-muted-foreground border border-border',
              )}
            >
              {ESTADO_LABEL[estado] ?? estado}
            </span>
          )}
          {withHuman && (
            <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/12 px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-amber-400">
              Com humano
            </span>
          )}
          {isClosed && (
            <span className="inline-flex items-center rounded-full border border-border bg-secondary px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Encerrada
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
