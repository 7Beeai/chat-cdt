'use client'

import { CreditCard, HelpCircle, Timer, XCircle } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'
import {
  formatWaId,
  relativeTime,
  windowRemaining,
} from '@/lib/format/time'

import { avatarGradient, unitColor } from './color-hash'
import type { ConversationListItem } from './inbox-client'

type HandoffReason = NonNullable<ConversationListItem['handoff_reason']>

/**
 * Each handoff_reason carries:
 *   - left accent bar color (solid HSL — drives the vertical sliver)
 *   - icon shown next to the contact name
 *   - short label rendered as a soft chip on the right
 *   - chip tint classes (bg/border/fg) tuned to the dark theme
 *
 * The left bar is the LOAD-bearing signal: it tells the operator at a glance
 * what kind of request needs attention.
 */
const HANDOFF: Record<
  HandoffReason,
  {
    label: string
    icon: typeof XCircle
    barColor: string
    chip: string
    iconColor: string
  }
> = {
  cancel: {
    label: 'Cancelamento',
    icon: XCircle,
    barColor: 'hsl(4 100% 65%)',
    chip: 'bg-red-500/12 text-red-300 border border-red-500/30',
    iconColor: 'text-red-400',
  },
  payment_re_register: {
    label: 'Pagamento',
    icon: CreditCard,
    barColor: 'hsl(38 92% 58%)',
    chip: 'bg-amber-500/12 text-amber-300 border border-amber-500/30',
    iconColor: 'text-amber-400',
  },
  other_support: {
    label: 'Suporte',
    icon: HelpCircle,
    barColor: 'hsl(205 90% 60%)',
    chip: 'bg-sky-500/12 text-sky-300 border border-sky-500/30',
    iconColor: 'text-sky-400',
  },
}

function initialsOf(name: string | null | undefined, fallback: string): string {
  const source = (name ?? '').trim()
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean)
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }
  const digits = fallback.replace(/\D/g, '')
  if (digits.length >= 2) return digits.slice(-2)
  return '#'
}

/**
 * Tone for the 24h Meta window pill. Renders ONLY when the window is
 * urgent (< 2h) or expired — otherwise it's hidden to keep the row quiet.
 */
function windowState(
  expiresAt: string | null,
  expired: boolean
): { show: boolean; urgent: boolean } {
  if (expired) return { show: true, urgent: true }
  if (!expiresAt) return { show: false, urgent: false }
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(diffMs)) return { show: false, urgent: false }
  // Show within last 2h.
  return { show: diffMs < 2 * 60 * 60 * 1000, urgent: diffMs < 30 * 60 * 1000 }
}

function UnitBadge({
  unit,
  unitIdFallback,
}: {
  unit: ConversationListItem['unit']
  unitIdFallback: string | null
}) {
  const seed = unit?.id ?? unitIdFallback
  if (!seed) {
    return (
      <span className="inline-flex items-center rounded-md border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        —
      </span>
    )
  }
  const c = unitColor(seed)
  const label = unit?.code?.toUpperCase() || unit?.name || seed.slice(0, 4)
  const style: CSSProperties = {
    backgroundColor: c.bg,
    borderColor: c.border,
    color: c.fg,
  }
  return (
    <span
      className="inline-flex max-w-[140px] items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em]"
      style={style}
      title={unit?.name ?? undefined}
    >
      <span
        className="inline-block size-1 shrink-0 rounded-full"
        style={{ backgroundColor: c.solid }}
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </span>
  )
}

function Avatar({
  seed,
  initials,
}: {
  seed: string
  initials: string
}) {
  const g = avatarGradient(seed)
  const style: CSSProperties = {
    background: `linear-gradient(135deg, ${g.from} 0%, ${g.to} 100%)`,
    color: g.fg,
  }
  return (
    <div
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tracking-tight shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.04)] ring-1 ring-border/60"
      style={style}
    >
      {initials}
    </div>
  )
}

export function InboxRow({
  conv,
  isActive = false,
}: {
  conv: ConversationListItem
  isActive?: boolean
}) {
  const displayName =
    conv.contact?.name?.trim() ||
    (conv.contact?.wa_id ? formatWaId(conv.contact.wa_id) : 'Desconhecido')

  const avatarSeed = conv.contact?.wa_id ?? conv.contact?.id ?? conv.id
  const initials = initialsOf(conv.contact?.name, conv.contact?.wa_id ?? '##')

  const previewText = conv.preview?.text?.trim() || 'Sem mensagens ainda'
  const previewPrefix = conv.preview?.direction === 'out' ? 'Você: ' : ''

  // Single, authoritative timestamp: time since last inbound (preferred) or
  // last preview event. No more dual-timestamp confusion.
  const time = relativeTime(
    conv.last_inbound_at ?? conv.preview?.createdAt ?? null
  )

  const handoff = conv.handoff_reason ? HANDOFF[conv.handoff_reason] : null
  const win = windowRemaining(conv.customer_window_expires_at)
  const winState = windowState(conv.customer_window_expires_at, win.expired)

  const isQueued = conv.routing === 'queued' && !conv.assigned_operator_id
  const isAssigned = conv.routing === 'human' && !!conv.assigned_operator_id

  // The left accent sliver does triple duty:
  //   - handoff color (cancel/payment/support) when present
  //   - lime when queued and no handoff (still needs attention)
  //   - lime when selected
  // Hover gets a background change only — no competing left bar.
  const leftBar: string | null = isActive
    ? 'hsl(83 79% 60%)'
    : handoff
      ? handoff.barColor
      : isQueued
        ? 'hsl(83 79% 60%)'
        : null

  return (
    <Link
      href={`/inbox/${conv.id}`}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group relative flex min-h-[78px] items-center gap-3.5 border-b border-border/60 px-5 py-3.5 transition-colors',
        isActive
          ? 'bg-secondary/70'
          : 'bg-card hover:bg-secondary/45 focus-visible:bg-secondary/45',
        // Subtle attention pull for queued rows (no handoff arrows): faint lime wash.
        !isActive && isQueued && !handoff && 'bg-accent/[0.025]',
        'focus-visible:outline-none'
      )}
    >
      {/* Left accent sliver — single channel, no collision. */}
      {leftBar ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: leftBar }}
        />
      ) : null}

      <Avatar seed={avatarSeed} initials={initials} />

      {/* Middle: name row + preview */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Top row: name + handoff icon */}
        <div className="flex min-w-0 items-center gap-1.5">
          {handoff ? (
            <handoff.icon
              className={cn('size-3.5 shrink-0', handoff.iconColor)}
              aria-hidden
            />
          ) : null}
          <span
            className={cn(
              'truncate text-sm font-semibold leading-tight',
              isActive ? 'text-foreground' : 'text-foreground'
            )}
          >
            {displayName}
          </span>
        </div>

        {/* Preview text */}
        <p
          className={cn(
            'line-clamp-1 text-[12.5px] leading-snug',
            isQueued && !isActive
              ? 'text-foreground/75'
              : 'text-muted-foreground'
          )}
        >
          {previewPrefix}
          {previewText}
        </p>

        {/* Bottom meta row: unit badge + queued chip + assigned chip */}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <UnitBadge unit={conv.unit} unitIdFallback={conv.unit_id} />
          {isQueued ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-accent/35 bg-accent/12 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-accent">
              <span className="size-1 rounded-full bg-accent live-dot" aria-hidden />
              Aguardando
            </span>
          ) : null}
          {isAssigned ? (
            <span className="inline-flex items-center rounded-md border border-border bg-secondary px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Atendido
            </span>
          ) : null}
        </div>
      </div>

      {/* Right rail: time on top, handoff chip, window pill (only if urgent) */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {time ? (
          <span
            className={cn(
              'font-mono-num text-[11px]',
              isQueued ? 'text-foreground/80' : 'text-muted-foreground'
            )}
          >
            {time}
          </span>
        ) : (
          <span aria-hidden className="h-[15px]" />
        )}

        {handoff ? (
          <span
            className={cn(
              'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              handoff.chip
            )}
          >
            {handoff.label}
          </span>
        ) : null}

        {winState.show ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono-num text-[10px] font-medium',
              winState.urgent
                ? 'border-red-500/30 bg-red-500/10 text-red-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            )}
            title={
              conv.customer_window_expires_at
                ? new Date(conv.customer_window_expires_at).toLocaleString(
                    'pt-BR'
                  )
                : undefined
            }
          >
            <Timer className="size-3" aria-hidden />
            <span>{win.expired ? 'Fora da janela' : win.label}</span>
          </span>
        ) : null}
      </div>
    </Link>
  )
}
