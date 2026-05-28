'use client'

import { Clock } from 'lucide-react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import {
  formatWaId,
  relativeTime,
  windowRemaining,
} from '@/lib/format/time'

import type { ConversationListItem } from './inbox-client'

type HandoffReason = NonNullable<ConversationListItem['handoff_reason']>

const PILL_BASE =
  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide'

const HANDOFF_BADGE: Record<
  HandoffReason,
  { label: string; className: string }
> = {
  payment_re_register: {
    label: 'Pagamento',
    className: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  },
  cancel: {
    label: 'Cancelamento',
    className: 'bg-red-500/15 text-red-400 border border-red-500/30',
  },
  other_support: {
    label: 'Suporte',
    className: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  },
}

function initialOf(name: string | null | undefined, fallback: string): string {
  const source = (name ?? '').trim() || fallback
  const first = source.replace(/^\+?/, '').charAt(0)
  return first ? first.toUpperCase() : '#'
}

/**
 * Resolves the visual tone for the Meta 24h window remaining timer.
 *   - expired   → red
 *   - < 2h left → amber
 *   - else      → muted
 */
function windowTone(expiresAt: string | null, expired: boolean): string {
  if (expired) return 'text-red-400'
  if (!expiresAt) return 'text-muted-foreground'
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(diffMs)) return 'text-muted-foreground'
  if (diffMs < 2 * 60 * 60 * 1000) return 'text-amber-400'
  return 'text-muted-foreground'
}

export function InboxRow({ conv }: { conv: ConversationListItem }) {
  const displayName =
    conv.contact?.name?.trim() ||
    (conv.contact?.wa_id ? formatWaId(conv.contact.wa_id) : 'Desconhecido')

  const initial = initialOf(conv.contact?.name, conv.contact?.wa_id ?? '#')

  const previewText = conv.preview?.text?.trim() || 'Sem mensagens ainda'
  const previewPrefix = conv.preview?.direction === 'out' ? 'Você: ' : ''

  const time = relativeTime(
    conv.last_inbound_at ?? conv.preview?.createdAt ?? null
  )

  const handoff = conv.handoff_reason
    ? HANDOFF_BADGE[conv.handoff_reason]
    : null
  const window24 = windowRemaining(conv.customer_window_expires_at)
  const windowToneClass = windowTone(
    conv.customer_window_expires_at,
    window24.expired
  )

  return (
    <Link
      href={`/inbox/${conv.id}`}
      className={cn(
        'group relative flex min-h-[76px] items-start gap-3 border-b border-border bg-card px-5 py-4 transition-colors',
        'before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-accent before:opacity-0 before:transition-opacity',
        'hover:bg-secondary/60 hover:before:opacity-100',
        'focus-visible:bg-secondary/60 focus-visible:outline-none focus-visible:before:opacity-100'
      )}
    >
      {/* Avatar */}
      <div
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-foreground"
      >
        {initial}
      </div>

      {/* Middle: timestamp + name + preview */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {time ? (
          <span className="font-mono-num text-[11px] text-muted-foreground">
            {time}
          </span>
        ) : null}
        <span className="truncate text-sm font-semibold text-foreground">
          {displayName}
        </span>
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {previewPrefix}
          {previewText}
        </p>
      </div>

      {/* Right column: badges + window */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {handoff ? (
            <span className={cn(PILL_BASE, handoff.className)}>
              {handoff.label}
            </span>
          ) : null}
          {conv.routing === 'queued' ? (
            <span
              className={cn(
                PILL_BASE,
                'border border-accent/30 bg-accent/15 text-accent'
              )}
            >
              Aguardando
            </span>
          ) : null}
          {conv.routing === 'human' && conv.assigned_operator_id ? (
            <span
              className={cn(
                PILL_BASE,
                'border border-border bg-secondary text-muted-foreground'
              )}
            >
              Atendido
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            'flex items-center gap-1 font-mono-num text-[11px]',
            windowToneClass
          )}
          title={
            conv.customer_window_expires_at
              ? new Date(conv.customer_window_expires_at).toLocaleString(
                  'pt-BR'
                )
              : undefined
          }
        >
          <Clock className="size-3" aria-hidden />
          <span>{window24.expired ? 'Fora da janela' : window24.label}</span>
        </div>
      </div>
    </Link>
  )
}
