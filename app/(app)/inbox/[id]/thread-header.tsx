'use client'

import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, Bot, Clock, UserCheck, X } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatWaId } from '@/lib/format/phone'
import { windowRemaining } from '@/lib/format/time'

import { assignToMe, closeConversation, returnToAI } from './actions'
import type { ConversationView } from './page'

type Props = {
  conv: ConversationView
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

const ROUTING_LABEL: Record<string, string> = {
  ai: 'IA',
  queued: 'Aguardando',
  human: 'Humano',
}

const ROUTING_TONE: Record<string, string> = {
  queued: 'bg-accent/15 text-accent border border-accent/30',
  human: 'bg-secondary text-foreground border border-border',
  ai: 'bg-secondary/60 text-muted-foreground border border-border',
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

export function ThreadHeader({ conv }: Props) {
  const [isPending, startTransition] = useTransition()
  const [, setTick] = useState(0)

  // Ticking clock so the window-remaining label stays accurate. 30s
  // granularity is plenty — the composer's "<2h amber" banner re-checks
  // on its own interval as well.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const win = windowRemaining(conv.customer_window_expires_at)
  const remainingMs = conv.customer_window_expires_at
    ? new Date(conv.customer_window_expires_at).getTime() - Date.now()
    : 0
  const isAmber =
    !win.expired && remainingMs > 0 && remainingMs < TWO_HOURS_MS

  const contactName =
    conv.contact?.name?.trim() ||
    formatWaId(conv.contact?.wa_id ?? '') ||
    'Contato'
  const crmTag = conv.contact?.crm_external_id ?? null
  const initials = getInitials(contactName)

  const canAssume =
    conv.routing === 'queued' && conv.assigned_operator_id === null
  const canReturn = conv.routing === 'human'

  function run(
    label: string,
    action: () => Promise<{ error?: string }>,
  ) {
    startTransition(async () => {
      const r = await action()
      if (r?.error) toast.error(`${label}: ${r.error}`)
      else toast.success(label)
    })
  }

  return (
    <header className="elegant-divider flex items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
      {/* Left: back + avatar + name/phone */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          render={<Link href="/inbox" />}
          aria-label="Voltar para a inbox"
        >
          <ArrowLeft />
        </Button>

        <Avatar className="size-9 shrink-0">
          <AvatarFallback className="bg-secondary font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {contactName}
            </span>
            {crmTag && (
              <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {crmTag}
              </span>
            )}
          </div>
          <span className="truncate font-mono-num text-xs text-muted-foreground">
            {formatWaId(conv.contact?.wa_id ?? '')}
          </span>
        </div>
      </div>

      {/* Center: handoff + routing badges */}
      <div className="hidden items-center gap-2 md:flex">
        {conv.handoff_reason && (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider',
              HANDOFF_TONE[conv.handoff_reason] ??
                'bg-secondary text-muted-foreground border border-border',
            )}
          >
            {HANDOFF_LABEL[conv.handoff_reason] ?? conv.handoff_reason}
          </span>
        )}
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider',
            ROUTING_TONE[conv.routing] ?? ROUTING_TONE.ai,
          )}
        >
          {ROUTING_LABEL[conv.routing]}
        </span>
      </div>

      {/* Right: window indicator + action buttons */}
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex items-center gap-1.5 font-mono-num text-xs',
            win.expired
              ? 'text-red-400'
              : isAmber
                ? 'text-amber-400'
                : 'text-muted-foreground',
          )}
          title={
            conv.customer_window_expires_at
              ? `Janela 24h expira em ${win.label}`
              : 'Sem janela ativa'
          }
        >
          <Clock className="size-3.5" />
          <span>{win.label}</span>
        </div>

        <div className="flex items-center gap-1.5">
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
              onClick={() =>
                run('Devolvida para IA', () => returnToAI(conv.id))
              }
            >
              <Bot />
              Devolver para IA
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
      </div>
    </header>
  )
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
