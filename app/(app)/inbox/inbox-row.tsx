'use client'

import {
  Check,
  CreditCard,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  Mic,
  Timer,
  UserRound,
  Video,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties, MouseEvent } from 'react'

import { formatWaId } from '@/lib/format/phone'
import { relativeTime, windowRemaining } from '@/lib/format/time'
import { unitColor } from '@/lib/unit-colors'
import { cn } from '@/lib/utils'

import type { ConversationListItem } from './list-data'
import type { PreviewKind } from './preview'
import { SLA_HEX, formatWait, slaTone, waitMinutes } from './sla'

type HandoffReason = NonNullable<ConversationListItem['handoff_reason']>

const HANDOFF: Record<
  HandoffReason,
  { label: string; icon: LucideIcon; iconColor: string }
> = {
  cancel: { label: 'Cancelamento', icon: XCircle, iconColor: 'text-red-400' },
  payment_re_register: {
    label: 'Pagamento',
    icon: CreditCard,
    iconColor: 'text-sky-400',
  },
  other_support: { label: 'Suporte', icon: HelpCircle, iconColor: 'text-amber-400' },
}

const PREVIEW_ICON: Partial<Record<PreviewKind, LucideIcon>> = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: FileText,
}

function initialsOf(name: string | null | undefined, fallback: string): string {
  const source = (name ?? '').trim()
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean)
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }
  const digits = fallback.replace(/\D/g, '')
  return digits.length >= 2 ? digits.slice(-2) : '#'
}

function windowState(
  expiresAt: string | null,
  expired: boolean,
): { show: boolean; urgent: boolean } {
  if (expired) return { show: true, urgent: true }
  if (!expiresAt) return { show: false, urgent: false }
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(diffMs)) return { show: false, urgent: false }
  return { show: diffMs < 2 * 60 * 60 * 1000, urgent: diffMs < 30 * 60 * 1000 }
}

export function InboxRow({
  conv,
  isActive = false,
  selected = false,
  onToggleSelect,
  currentUserId,
  operatorNames = {},
}: {
  conv: ConversationListItem
  isActive?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  currentUserId?: string
  operatorNames?: Record<string, string>
}) {
  const displayName =
    conv.contact?.name?.trim() ||
    (conv.contact?.wa_id ? formatWaId(conv.contact.wa_id) : 'Desconhecido')
  const initials = initialsOf(conv.contact?.name, conv.contact?.wa_id ?? '##')

  const unitSeed = conv.unit?.id ?? conv.unit_id
  const uc = unitSeed ? unitColor(unitSeed) : null
  const unitLabel =
    conv.unit?.name || conv.unit?.code?.toUpperCase() || null

  const isQueued = conv.routing === 'queued' && !conv.assigned_operator_id
  const isAssigned = !!conv.assigned_operator_id
  const isClosed = conv.status === 'closed'
  const ownedByMe =
    !!conv.assigned_operator_id && conv.assigned_operator_id === currentUserId
  const ownerLabel = conv.assigned_operator_id
    ? ownedByMe
      ? 'Você'
      : (operatorNames[conv.assigned_operator_id] ?? 'Operador')
    : null

  const handoff = conv.handoff_reason ? HANDOFF[conv.handoff_reason] : null

  const wait = waitMinutes(conv.last_inbound_at)
  const tone = isQueued ? slaTone(wait) : null
  const win = windowRemaining(conv.customer_window_expires_at)
  const winState = windowState(conv.customer_window_expires_at, win.expired)

  // Left accent sliver: lime when active or queued-needing-attention.
  const leftBar = isActive || (isQueued && !handoff) ? 'hsl(83 79% 60%)' : null

  const avatarStyle: CSSProperties = uc
    ? { backgroundColor: uc.bg, borderColor: uc.border, color: uc.fg }
    : {
        backgroundColor: 'hsl(240 9% 46% / 0.14)',
        borderColor: 'hsl(240 9% 46% / 0.35)',
        color: 'hsl(240 9% 60%)',
      }

  const handleToggle = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(conv.id)
  }

  return (
    <Link
      href={`/inbox/${conv.id}`}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group relative flex gap-2.5 border-b border-border/60 py-3 pl-4 pr-[18px] transition-colors',
        isActive
          ? 'bg-secondary'
          : selected
            ? 'bg-accent/[0.06]'
            : 'hover:bg-foreground/[0.022]',
      )}
    >
      {leftBar && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5"
          style={{ backgroundColor: leftBar }}
        />
      )}

      {/* Avatar ⇄ checkbox */}
      <div className="relative size-[38px] shrink-0">
        <div
          className={cn(
            'flex size-[38px] items-center justify-center rounded-full border-[1.5px] text-[12.5px] font-bold',
            (selected || onToggleSelect) && 'group-hover:opacity-0',
            selected && 'opacity-0',
          )}
          style={avatarStyle}
          aria-hidden
        >
          {initials}
        </div>
        {onToggleSelect && (
          <button
            type="button"
            onClick={handleToggle}
            aria-label={selected ? 'Desmarcar' : 'Selecionar'}
            aria-pressed={selected}
            className={cn(
              'absolute inset-0 flex items-center justify-center rounded-full border transition-opacity',
              selected
                ? 'border-accent bg-accent text-accent-foreground opacity-100'
                : 'border-border bg-background/40 opacity-0 group-hover:opacity-100',
            )}
          >
            {selected && <Check className="size-4" />}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        {/* Line 1: name + time/SLA */}
        <div className="flex items-center gap-2">
          {handoff && (
            <handoff.icon
              className={cn('size-3.5 shrink-0', handoff.iconColor)}
              aria-hidden
            />
          )}
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">
            {displayName}
          </span>
          {isClosed ? (
            <Check className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          ) : tone ? (
            <span
              className="shrink-0 font-mono text-[10px] font-bold tabular-nums"
              style={{ color: SLA_HEX[tone] }}
            >
              {formatWait(wait)}
            </span>
          ) : (
            <span className="shrink-0 font-mono-num text-[10px] text-muted-foreground">
              {relativeTime(conv.last_inbound_at ?? conv.preview?.createdAt ?? null)}
            </span>
          )}
        </div>

        {/* Line 2: preview */}
        <Preview preview={conv.preview} dimmed={!isQueued || isActive} />

        {/* Line 3: unit tag + signals */}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {unitLabel && uc ? (
            <span
              className="inline-flex max-w-[150px] items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.04em]"
              style={{ borderColor: uc.border, color: uc.fg }}
              title={conv.unit?.name ?? undefined}
            >
              <span
                className="size-1 shrink-0 rounded-full"
                style={{ backgroundColor: uc.solid }}
                aria-hidden
              />
              <span className="truncate">{unitLabel}</span>
            </span>
          ) : null}

          {isAssigned && ownerLabel && (
            <span
              className={cn(
                'inline-flex max-w-[140px] items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.04em]',
                ownedByMe
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-sky-400/30 bg-sky-400/10 text-sky-400',
              )}
              title={`Em atendimento por ${ownerLabel}`}
            >
              <UserRound className="size-2.5 shrink-0" aria-hidden />
              <span className="truncate">{ownerLabel}</span>
            </span>
          )}

          {winState.show && (
            <span
              className={cn(
                'ml-auto inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono-num text-[9.5px] font-medium',
                winState.urgent
                  ? 'border-red-500/30 bg-red-500/10 text-red-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
              )}
              title={
                conv.customer_window_expires_at
                  ? new Date(conv.customer_window_expires_at).toLocaleString('pt-BR')
                  : undefined
              }
            >
              <Timer className="size-2.5" aria-hidden />
              {win.expired ? 'fora 24h' : win.label}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

function Preview({
  preview,
  dimmed,
}: {
  preview: ConversationListItem['preview']
  dimmed: boolean
}) {
  const text = preview?.text?.trim() || 'Sem mensagens ainda'
  const prefix = preview?.direction === 'out' ? 'Você: ' : ''
  const kind = preview?.kind ?? 'text'
  const Icon = PREVIEW_ICON[kind]
  const cls = cn(
    'truncate text-[12.5px] leading-snug',
    dimmed ? 'text-muted-foreground' : 'text-foreground/75',
  )

  if (kind === 'button') {
    return (
      <span className={cn('flex items-center gap-1.5', cls)}>
        <span className="shrink-0 rounded border border-border px-1 py-px font-mono text-[9px] text-sky-400">
          botão
        </span>
        <span className="truncate">{text}</span>
      </span>
    )
  }
  if (Icon) {
    return (
      <span className={cn('flex items-center gap-1.5', cls)}>
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">
          {prefix}
          {text}
        </span>
      </span>
    )
  }
  return (
    <p className={cls}>
      {prefix}
      {text}
    </p>
  )
}
