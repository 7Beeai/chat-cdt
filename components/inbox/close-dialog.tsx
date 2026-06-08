'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

import {
  CLOSE_OUTCOMES,
  CLOSE_PAYMENT_METHODS,
  type CloseOutcome,
} from '@/app/(app)/inbox/outcomes'
import type { HandoffReason } from '@/app/(app)/inbox/list-data'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * Close dialog — forces a resolution outcome (the EXIT axis) before a
 * conversation can be closed. Used by the thread header and the bulk bar.
 */
export function CloseDialog({
  open,
  onOpenChange,
  count = 1,
  handoffReason,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** How many conversations are being closed (>1 from the bulk bar). */
  count?: number
  /**
   * Handoff reason of the conversation being closed. Drives the conditional
   * payment-method field. Omitted (e.g. bulk close over mixed reasons) → the
   * field never shows.
   */
  handoffReason?: HandoffReason | null
  pending?: boolean
  onConfirm: (
    outcome: CloseOutcome,
    note?: string,
    paymentMethod?: string,
    cardReregistered?: boolean,
  ) => void
}) {
  const [outcome, setOutcome] = useState<CloseOutcome | null>(null)
  const [note, setNote] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null)
  const [cardReregistered, setCardReregistered] = useState<boolean | null>(null)

  // "Recadastro de pagamento" gets a card-specific close flow: a mandatory
  // "cartão recadastrado?" toggle on top, orthogonal to the outcome radios.
  const isCartao = handoffReason === 'payment_re_register'
  const cardMissing = isCartao && cardReregistered === null

  // Only on a re-registration handoff resolved successfully do we need to know
  // which payment method the customer registered. Required when shown.
  const needsPaymentMethod =
    handoffReason === 'payment_re_register' && outcome === 'resolvido'
  const paymentMissing = needsPaymentMethod && !paymentMethod

  function reset() {
    setOutcome(null)
    setNote('')
    setPaymentMethod(null)
    setCardReregistered(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <X className="size-4 text-muted-foreground" />
            {count > 1 ? `Encerrar ${count} atendimentos` : 'Encerrar atendimento'}
          </DialogTitle>
          <DialogDescription>
            Qual foi o desfecho? Isso alimenta as métricas de resolução.
          </DialogDescription>
        </DialogHeader>

        {isCartao && (
          <div className="rounded-[10px] border border-accent/30 bg-accent/[0.06] p-3">
            <span className="mb-2 block text-[13px] font-semibold text-foreground">
              Cartão recadastrado com sucesso?{' '}
              <span className="text-accent">*</span>
            </span>
            <div className="flex gap-1.5">
              {[
                { v: true, label: 'Sim' },
                { v: false, label: 'Não' },
              ].map((opt) => {
                const active = cardReregistered === opt.v
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setCardReregistered(opt.v)}
                    aria-pressed={active}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors',
                      active
                        ? 'border-accent bg-accent text-accent-foreground'
                        : 'border-border bg-card hover:border-accent/40 hover:bg-secondary',
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {CLOSE_OUTCOMES.map((o) => {
            const active = outcome === o.value
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setOutcome(o.value)}
                aria-pressed={active}
                className={cn(
                  'flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                  active
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-accent/30 hover:bg-secondary',
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border',
                    active ? 'border-accent' : 'border-muted-foreground/40',
                  )}
                >
                  {active && <span className="size-2 rounded-full bg-accent" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-foreground">
                    {o.label}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {o.hint}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {needsPaymentMethod && (
          <div className="rounded-[10px] border border-accent/30 bg-accent/[0.06] p-2.5">
            <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-accent">
              Forma de pagamento cadastrada *
            </span>
            <div className="flex flex-wrap gap-1.5">
              {CLOSE_PAYMENT_METHODS.map((m) => {
                const active = paymentMethod === m.value
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setPaymentMethod(m.value)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
                      active
                        ? 'border-accent bg-accent text-accent-foreground'
                        : 'border-border bg-card hover:border-accent/40 hover:bg-secondary',
                    )}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Nota (opcional)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Detalhe rápido do atendimento…"
            className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() =>
              outcome &&
              !paymentMissing &&
              !cardMissing &&
              onConfirm(
                outcome,
                note,
                paymentMethod ?? undefined,
                isCartao ? (cardReregistered ?? undefined) : undefined,
              )
            }
            disabled={pending || !outcome || paymentMissing || cardMissing}
          >
            {pending ? 'Encerrando…' : 'Encerrar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
