'use client'

import { useCallback, useEffect, useState } from 'react'
import { HeartHandshake, Loader2, Send, Wallet } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Props = {
  open: boolean
  onClose: () => void
  conversationId: string
  /** Meta WABA id (TEXT) — matches template_inventory.waba_id. */
  wabaId: string
  /** Primeiro nome do contato — preenche o {{1}} automaticamente. */
  contactFirstName: string
}

/**
 * Picker de RETOMADA (não é mais o catálogo da WABA): só os 2 templates de
 * reabertura de janela, com o {{1}} preenchido com o primeiro nome do contato
 * e envio em 1 clique — operador não digita variável nenhuma (docs/13, item D).
 * A resolução de variações do Sentinel (sufixos _s1_...) é feita na rota
 * `/api/templates?purpose=reopen`, por prefixo, pegando a mais recente.
 */

type ReopenOption = {
  base: 'suporte' | 'recadastro'
  title: string
  template_name: string | null
  body: string | null
}

export function TemplatePicker({
  open,
  onClose,
  conversationId,
  wabaId,
  contactFirstName,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState<ReopenOption[]>([])
  const [sendingBase, setSendingBase] = useState<string | null>(null)

  // Re-fetch a cada abertura — barato (2 linhas) e pega pausas/variações
  // novas do Sentinel sem precisar recarregar a página.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    fetch(
      `/api/templates?waba_id=${encodeURIComponent(wabaId)}&purpose=reopen`,
      { cache: 'no-store' },
    )
      .then(async (r) => {
        if (cancelled) return
        if (!r.ok) {
          console.error('[template-picker] fetch failed', r.status)
          toast.error('Falha ao carregar templates de retomada.')
          setOptions([])
          return
        }
        const body = (await r.json()) as { reopen?: ReopenOption[] }
        setOptions(body.reopen ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[template-picker] network error', err)
        toast.error('Falha de rede ao carregar templates.')
        setOptions([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, wabaId])

  const onSend = useCallback(
    async (opt: ReopenOption) => {
      if (!opt.template_name || sendingBase) return
      setSendingBase(opt.base)
      try {
        // {{1}} = primeiro nome. Se o corpo não tiver variável (variação do
        // Sentinel sem placeholder), não manda components — a Meta rejeita
        // parâmetro sobrando. Corpo irresolvível (inventário e Graph sem
        // texto): assume 1 variável — todos os retomada_* têm {{1}}.
        const varCount = opt.body ? countVariables(opt.body) : 1
        const components =
          varCount > 0
            ? [
                {
                  type: 'body',
                  parameters: Array.from({ length: varCount }, () => ({
                    type: 'text',
                    text: contactFirstName,
                  })),
                },
              ]
            : []

        const r = await fetch('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            type: 'template',
            template: {
              name: opt.template_name,
              language: 'pt_BR',
              components,
            },
          }),
        })

        if (r.ok) {
          toast.success('Mensagem de retomada enviada.')
          onClose()
        } else if (r.status === 502) {
          let detail = ''
          try {
            const body = (await r.json()) as { details?: unknown }
            detail =
              typeof body?.details === 'object' && body.details
                ? JSON.stringify(body.details).slice(0, 200)
                : ''
          } catch {
            // ignore
          }
          toast.error(`Falha no envio (Graph): ${detail || 'erro 502'}`)
        } else {
          toast.error(`Falha no envio (${r.status}).`)
        }
      } catch (err) {
        toast.error(
          'Falha de rede. ' + (err instanceof Error ? err.message : ''),
        )
      } finally {
        setSendingBase(null)
      }
    },
    [conversationId, contactFirstName, sendingBase, onClose],
  )

  const available = options.filter((o) => o.template_name)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Retomar conversa</DialogTitle>
          <DialogDescription>
            Fora da janela de 24h só é possível enviar um template aprovado.
            Escolha o motivo — a mensagem já sai pronta.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Carregando...
          </div>
        ) : available.length === 0 ? (
          <div className="py-8 text-center font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Nenhum template de retomada disponível nesta WABA.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {available.map((opt) => {
              const sending = sendingBase === opt.base
              const Icon = opt.base === 'recadastro' ? Wallet : HeartHandshake
              return (
                <div
                  key={opt.base}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-card px-3.5 py-3"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-accent" />
                    <span className="text-sm font-semibold text-foreground">
                      {opt.title}
                    </span>
                  </div>
                  {opt.body && (
                    <p className="rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-xs whitespace-pre-wrap text-muted-foreground">
                      {fillFirstName(opt.body, contactFirstName)}
                    </p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void onSend(opt)}
                    disabled={sendingBase !== null}
                    className="self-end"
                  >
                    {sending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Send />
                    )}
                    Enviar
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Quantos {{n}} distintos o corpo tem (esperado: 0 ou 1). */
function countVariables(body: string | null): number {
  if (!body) return 0
  const found = new Set<string>()
  const re = /\{\{(\d+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) found.add(m[1])
  return found.size
}

/** Preview: todo {{n}} vira o primeiro nome (os templates só usam {{1}}). */
function fillFirstName(body: string, firstName: string): string {
  return body.replace(/\{\{\d+\}\}/g, firstName)
}
