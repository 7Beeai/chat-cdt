'use client'

import type { CSSProperties, ReactNode } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  Copy,
  ExternalLink,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import type {
  ConversationView,
  DebtorContext,
  DebtorPaymentLink,
} from '@/app/(app)/inbox/[id]/page'
import { HANDOFF_LABEL } from '@/app/(app)/inbox/list-data'
import { formatBRL } from '@/lib/format/currency'
import { nameInitials } from '@/lib/format/name'
import { formatWaId } from '@/lib/format/phone'
import { windowRemaining } from '@/lib/format/time'
import { unitColor } from '@/lib/unit-colors'
import { cn } from '@/lib/utils'

const ROUTING_LABEL: Record<string, string> = {
  ai: 'IA (bot)',
  queued: 'Aguardando humano',
  human: 'Em atendimento',
}

export function ContextPanel({
  conversation,
  debtor,
  onClose,
}: {
  conversation: ConversationView
  debtor: DebtorContext | null
  /** Closes the panel — only surfaced on compact screens (overlay mode). */
  onClose?: () => void
}) {
  const contactName =
    conversation.contact?.name?.trim() ||
    formatWaId(conversation.contact?.wa_id ?? '') ||
    'Contato'
  const phone = formatWaId(conversation.contact?.wa_id ?? '')
  const initials = getInitials(contactName)

  const unitSeed = conversation.unit?.id ?? conversation.unit_id
  const uc = unitSeed ? unitColor(unitSeed) : null
  const unitName =
    conversation.unit?.name || conversation.unit?.code?.toUpperCase() || null

  const avatarStyle: CSSProperties = uc
    ? { backgroundColor: uc.bg, borderColor: uc.border, color: uc.fg }
    : {
        backgroundColor: 'hsl(240 9% 46% / 0.14)',
        borderColor: 'hsl(240 9% 46% / 0.35)',
        color: 'hsl(240 9% 60%)',
      }

  const matched = !!debtor?.matched
  const win = windowRemaining(conversation.customer_window_expires_at)

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[86%] max-w-[340px] flex-col overflow-y-auto border-l border-border bg-background shadow-2xl lg:static lg:z-auto lg:w-[280px] lg:shrink-0 lg:shadow-none xl:w-[300px]">
      {/* Close — compact overlay only */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar detalhes"
          className="absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
        >
          <X className="size-4" />
        </button>
      )}

      {/* Identity */}
      <div className="flex flex-col items-center gap-2 px-5 pb-3.5 pt-5 text-center">
        <div
          className="flex size-[52px] items-center justify-center rounded-full border-[1.5px] text-[17px] font-bold"
          style={avatarStyle}
          aria-hidden
        >
          {initials}
        </div>
        <div>
          <div className="text-[14.5px] font-bold tracking-[-0.01em] text-foreground">
            {contactName}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {phone}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {unitName && uc && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.04em]"
              style={{ borderColor: uc.border, color: uc.fg }}
            >
              <span
                className="size-[5px] rounded-full"
                style={{ backgroundColor: uc.solid }}
                aria-hidden
              />
              {unitName}
            </span>
          )}
          <TrilhoBadge trilho={debtor?.trilho} />
        </div>
      </div>

      {/* Cobrança — escondida para contatos de relacionamento (sem dívida) */}
      {matched && debtor ? (
        <DebtSection debtor={debtor} />
      ) : debtor?.trilho === 'relacionamento' ? null : (
        <div className="border-b border-border px-5 pb-4 text-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            Cobrança
          </p>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Sem cadastro de cobrança vinculado a este contato.
          </p>
        </div>
      )}

      {/* This conversation */}
      <Section label="Conversa">
        <Fact
          label="Motivo do handoff"
          value={
            conversation.handoff_reason
              ? (HANDOFF_LABEL[conversation.handoff_reason] ??
                conversation.handoff_reason)
              : '—'
          }
        />
        <Fact
          label="Roteamento"
          value={ROUTING_LABEL[conversation.routing] ?? conversation.routing}
        />
        <Fact
          label="Janela 24h"
          value={win.expired ? 'Fora da janela' : win.label}
          tone={win.expired ? 'danger' : undefined}
        />
      </Section>

      {/* Internal note placeholder — feature pending a notes table */}
      <div className="mt-auto px-5 py-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70">
          Nota interna
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/60">
          Anotações da equipe chegam numa próxima versão.
        </p>
      </div>
    </aside>
  )
}

/**
 * Selo do trilho do contato (migration 0015): cobrança (telefone casa com
 * devedor) ou relacionamento (telefone casa com adimplentes_base). Quando o
 * contato não está em nenhuma base, `trilho` é null/ausente e não renderiza.
 */
function TrilhoBadge({
  trilho,
}: {
  trilho?: 'cobranca' | 'relacionamento' | null
}) {
  if (trilho !== 'cobranca' && trilho !== 'relacionamento') return null
  const cfg =
    trilho === 'cobranca'
      ? {
          label: 'Cobrança',
          cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
          dot: 'rgb(251 191 36)',
        }
      : {
          label: 'Relacionamento',
          cls: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
          dot: 'rgb(56 189 248)',
        }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.04em]',
        cfg.cls,
      )}
    >
      <span
        className="size-[5px] rounded-full"
        style={{ backgroundColor: cfg.dot }}
        aria-hidden
      />
      {cfg.label}
    </span>
  )
}

function DebtSection({ debtor }: { debtor: DebtorContext }) {
  const paid = !!debtor.pagamento_feito
  const value = debtor.valor_aberto ?? null

  return (
    <>
      {/* Headline */}
      <div className="border-b border-border px-5 pb-4 text-center">
        {debtor.ambiguous && (
          <div className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-left">
            <AlertTriangle className="mt-px size-3 shrink-0 text-amber-400" />
            <span className="text-[10.5px] leading-snug text-amber-300">
              Múltiplos cadastros neste telefone — confirme a matrícula.
            </span>
          </div>
        )}

        {paid ? (
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-accent">
            <BadgeCheck className="size-3.5" />
            Pagamento confirmado
          </div>
        ) : value != null ? (
          <>
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              Valor em aberto
            </p>
            <p className="mt-1 text-[28px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {formatBRL(value)}
            </p>
            {(debtor.status || debtor.regua) && (
              <p className="mt-1.5 font-mono text-[11px] capitalize text-amber-400">
                {[debtor.status, debtor.regua].filter(Boolean).join(' · ')}
              </p>
            )}
          </>
        ) : (
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Sem valor em aberto
          </p>
        )}
      </div>

      {/* Cadastro */}
      <Section label="Cadastro de cobrança">
        {debtor.matricula && (
          <Fact label="Matrícula" value={debtor.matricula} mono />
        )}
        {debtor.status && !paid && <Fact label="Status" value={cap(debtor.status)} />}
        {debtor.regua && <Fact label="Régua" value={debtor.regua} />}
        <Fact
          label="Tentativas de contato"
          value={String(Math.round(debtor.tentativas ?? 0))}
          mono
        />
      </Section>

      {/* Link de pagamento */}
      {debtor.ultimo_link && (
        <PaymentLinkSection link={debtor.ultimo_link} />
      )}

      {/* Pagamentos */}
      {(debtor.qtd_pagamentos ?? 0) > 0 && (
        <Section label="Pagamentos">
          {debtor.ultimo_pagamento && (
            <Fact
              label="Último"
              value={`${formatBRL(debtor.ultimo_pagamento.valor)}${
                debtor.ultimo_pagamento.forma
                  ? ` · ${debtor.ultimo_pagamento.forma}`
                  : ''
              }`}
            />
          )}
          {debtor.ultimo_pagamento?.data && (
            <Fact label="Em" value={fmtDate(debtor.ultimo_pagamento.data)} mono />
          )}
          <Fact
            label={`Total (${debtor.qtd_pagamentos})`}
            value={formatBRL(debtor.total_pago)}
            mono
          />
        </Section>
      )}
    </>
  )
}

function PaymentLinkSection({ link }: { link: DebtorPaymentLink }) {
  const s = statusOf(link)

  function copyPix() {
    if (!link.pix_copia_cola) return
    navigator.clipboard
      .writeText(link.pix_copia_cola)
      .then(() => toast.success('PIX copia-e-cola copiado'))
      .catch(() => toast.error('Não foi possível copiar'))
  }

  return (
    <div className="border-b border-border px-5 py-3.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Link de pagamento
        </p>
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.04em]',
            s.cls,
          )}
        >
          {s.label}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] text-muted-foreground">Valor</span>
        <span className="font-mono-num text-[13px] font-semibold text-foreground">
          {formatBRL(link.valor)}
        </span>
      </div>
      {link.gerado_em && (
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          gerado {fmtDate(link.gerado_em)}
          {link.expira_em ? ` · expira ${fmtDate(link.expira_em)}` : ''}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {link.pix_copia_cola && (
          <button
            type="button"
            onClick={copyPix}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11.5px] text-foreground transition-colors hover:border-accent/50 hover:text-accent"
          >
            <Copy className="size-3" />
            Copiar PIX
          </button>
        )}
        {link.link && (
          <a
            href={link.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11.5px] text-foreground transition-colors hover:border-accent/50 hover:text-accent"
          >
            <ExternalLink className="size-3" />
            Abrir link
          </a>
        )}
      </div>
    </div>
  )
}

function statusOf(link: DebtorPaymentLink): { label: string; cls: string } {
  const expired = link.expira_em
    ? new Date(link.expira_em).getTime() < Date.now()
    : false
  const s = (link.status ?? '').toLowerCase()
  if (s === 'paid')
    return { label: 'Pago', cls: 'border-accent/30 bg-accent/10 text-accent' }
  if (s === 'cancelled' || s === 'canceled')
    return {
      label: 'Cancelado',
      cls: 'border-border bg-secondary text-muted-foreground',
    }
  if (expired)
    return {
      label: 'Expirado',
      cls: 'border-border bg-secondary text-muted-foreground',
    }
  if (s === 'pending')
    return {
      label: 'Pendente',
      cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    }
  return {
    label: s || '—',
    cls: 'border-border bg-secondary text-muted-foreground',
  }
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-border px-5 py-3.5">
      <p className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function Fact({
  label,
  value,
  mono,
  tone,
}: {
  label: string
  value: string
  mono?: boolean
  tone?: 'danger'
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[12.5px] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'min-w-0 truncate text-right text-[12px] text-foreground',
          mono && 'font-mono-num',
          tone === 'danger' && 'text-red-400',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function getInitials(name: string): string {
  return nameInitials(name) || '??'
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('pt-BR')
}
