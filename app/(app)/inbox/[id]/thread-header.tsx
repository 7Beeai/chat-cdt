'use client'

import { useEffect, useState, useTransition } from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowLeft,
  Bot,
  Clock,
  Info,
  MoreHorizontal,
  UserCheck,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { formatWaId } from '@/lib/format/phone'
import { unitColor } from '@/lib/unit-colors'
import { waitMinutes } from '@/app/(app)/inbox/sla'

import { assignToMe, closeConversation, returnToAI } from './actions'
import type { ConversationView } from './page'

type Props = {
  conv: ConversationView
  contextOpen?: boolean
  onToggleContext?: () => void
}

const HANDOFF_LABEL: Record<string, string> = {
  payment_re_register: 'Recadastro pagamento',
  cancel: 'Cancelamento',
  other_support: 'Suporte',
}

const HANDOFF_TONE: Record<string, string> = {
  payment_re_register:
    'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  cancel: 'bg-red-500/15 text-red-400 border border-red-500/30',
  other_support: 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

export function ThreadHeader({ conv, contextOpen, onToggleContext }: Props) {
  const [isPending, startTransition] = useTransition()
  const [, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const remainingMs = conv.customer_window_expires_at
    ? new Date(conv.customer_window_expires_at).getTime() - Date.now()
    : 0
  const winExpired = !conv.customer_window_expires_at || remainingMs <= 0
  const isAmber = !winExpired && remainingMs > 0 && remainingMs < TWO_HOURS_MS
  const winLabel = winLabelOf(remainingMs, winExpired)

  const contactName =
    conv.contact?.name?.trim() ||
    formatWaId(conv.contact?.wa_id ?? '') ||
    'Contato'
  const initials = getInitials(contactName)
  const waIdFormatted = formatWaId(conv.contact?.wa_id ?? '')

  const unitSeed = conv.unit?.id ?? conv.unit_id
  const uc = unitSeed ? unitColor(unitSeed) : null
  const unitName = conv.unit?.name ?? null
  const avatarStyle: CSSProperties = uc
    ? { backgroundColor: uc.bg, borderColor: uc.border, color: uc.fg }
    : {
        backgroundColor: 'hsl(240 9% 46% / 0.14)',
        borderColor: 'hsl(240 9% 46% / 0.35)',
        color: 'hsl(240 9% 60%)',
      }

  const isQueued =
    conv.routing === 'queued' && conv.assigned_operator_id === null
  const wait = waitMinutes(conv.last_inbound_at)

  const canAssume = isQueued
  const canReturn = conv.routing === 'human'

  function run(label: string, action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const r = await action()
      if (r?.error) toast.error(`${label}: ${r.error}`)
      else toast.success(label)
    })
  }

  return (
    <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur-sm sm:px-[22px]">
      {/* Back (mobile only — desktop keeps the persistent list) */}
      <Button
        variant="ghost"
        size="icon-sm"
        render={<Link href="/inbox" />}
        aria-label="Voltar para a inbox"
        className="shrink-0 lg:hidden"
      >
        <ArrowLeft />
      </Button>

      {/* Identity */}
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[12.5px] font-bold"
        style={avatarStyle}
        aria-hidden
      >
        {initials}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">
            {contactName}
          </span>
          {isQueued && (
            <span className="hidden shrink-0 items-center rounded-full bg-amber-500/12 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-amber-400 sm:inline-flex">
              aguardando{wait != null ? ` · há ${wait}m` : ''}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">
          {waIdFormatted}
          {unitName ? ` · ${unitName}` : ''}
        </div>
      </div>

      {/* Handoff chip */}
      {conv.handoff_reason && (
        <span
          className={cn(
            'hidden shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider md:inline-flex',
            HANDOFF_TONE[conv.handoff_reason] ??
              'bg-secondary text-muted-foreground border border-border',
          )}
        >
          {HANDOFF_LABEL[conv.handoff_reason] ?? conv.handoff_reason}
        </span>
      )}

      {/* Window pill */}
      <div
        className={cn(
          'hidden shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 font-mono-num text-[11px] sm:inline-flex',
          winExpired
            ? 'border-red-500/30 bg-red-500/10 text-red-400'
            : isAmber
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
              : 'border-border bg-secondary/60 text-muted-foreground',
        )}
        title={
          conv.customer_window_expires_at
            ? `Janela 24h: ${winLabel}`
            : 'Sem janela ativa'
        }
      >
        <Clock className="size-3" />
        <span>{winLabel}</span>
      </div>

      {/* Desktop actions */}
      <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
        {canAssume && (
          <Button
            size="sm"
            variant="default"
            disabled={isPending}
            onClick={() => run('Assumida', () => assignToMe(conv.id))}
          >
            <UserCheck />
            Assumir
          </Button>
        )}
        {canReturn && (
          <Button
            size="sm"
            variant="secondary"
            disabled={isPending}
            onClick={() => run('Devolvida para IA', () => returnToAI(conv.id))}
          >
            <Bot />
            Devolver
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => run('Encerrada', () => closeConversation(conv.id))}
        >
          <X />
          Encerrar
        </Button>
      </div>

      {/* Context panel toggle */}
      {onToggleContext && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleContext}
          aria-pressed={contextOpen}
          aria-label="Detalhes do contato"
          title="Detalhes do contato"
          className={cn('shrink-0', contextOpen && 'text-accent')}
        >
          <Info />
        </Button>
      )}

      {/* Mobile actions → sheet */}
      <Sheet>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 lg:hidden"
              aria-label="Ações"
            >
              <MoreHorizontal />
            </Button>
          }
        />
        <SheetContent side="right" className="w-72">
          <div className="flex flex-col gap-4 py-4">
            <div className="border-b border-border pb-4">
              <p className="text-sm font-semibold">{contactName}</p>
              <p className="font-mono-num text-xs text-muted-foreground">
                {waIdFormatted}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {canAssume && (
                <SheetClose
                  render={
                    <Button
                      variant="default"
                      disabled={isPending}
                      onClick={() => run('Assumida', () => assignToMe(conv.id))}
                    >
                      <UserCheck />
                      Assumir
                    </Button>
                  }
                />
              )}
              {canReturn && (
                <SheetClose
                  render={
                    <Button
                      variant="secondary"
                      disabled={isPending}
                      onClick={() =>
                        run('Devolvida para IA', () => returnToAI(conv.id))
                      }
                    >
                      <Bot />
                      Devolver para IA
                    </Button>
                  }
                />
              )}
              <SheetClose
                render={
                  <Button
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      run('Encerrada', () => closeConversation(conv.id))
                    }
                  >
                    <X />
                    Encerrar
                  </Button>
                }
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  )
}

function winLabelOf(remainingMs: number, expired: boolean): string {
  if (expired) return 'fora 24h'
  const min = Math.floor(remainingMs / 60_000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const rem = min % 60
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`
  return `${Math.floor(h / 24)}d`
}

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
