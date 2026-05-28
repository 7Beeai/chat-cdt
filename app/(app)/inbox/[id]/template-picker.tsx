'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

type Props = {
  open: boolean
  onClose: () => void
  conversationId: string
  /** Meta WABA id (TEXT) — matches template_inventory.waba_id. */
  wabaId: string
}

type TemplateRow = {
  template_name: string
  body_text: string | null
  components: unknown
  category: string | null
  status: string
  is_active_in_cadence: boolean | null
  language: string | null
}

export function TemplatePicker({
  open,
  onClose,
  conversationId,
  wabaId,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [selected, setSelected] = useState<TemplateRow | null>(null)
  const [vars, setVars] = useState<string[]>([])
  const [sending, setSending] = useState(false)

  // Re-fetch each time the dialog opens. Cheap — list is filtered to one
  // WABA and APPROVED-only, typically <50 rows.
  useEffect(() => {
    if (!open) {
      setSelected(null)
      setVars([])
      return
    }
    let cancelled = false
    setLoading(true)
    // Fetch via our server endpoint instead of the browser supabase client
    // because template_inventory is owned by n8n and its RLS policy keys off
    // user_unit_permissions (not our user_units). The endpoint uses
    // service-role after confirming the operator owns this WABA.
    fetch(`/api/templates?waba_id=${encodeURIComponent(wabaId)}`, {
      cache: 'no-store',
    })
      .then(async (r) => {
        if (cancelled) return
        if (!r.ok) {
          console.error('[template-picker] fetch failed', r.status)
          toast.error('Falha ao carregar templates.')
          setTemplates([])
          return
        }
        const body = (await r.json()) as { templates?: TemplateRow[] }
        setTemplates(body.templates ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[template-picker] network error', err)
        toast.error('Falha de rede ao carregar templates.')
        setTemplates([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, wabaId])

  const variableIndices = useMemo(() => {
    if (!selected) return [] as number[]
    return extractVariables(selected)
  }, [selected])

  // Whenever the selected template changes, reset the vars buffer to a
  // fresh array of empty strings sized to the placeholder count. We key
  // on `selected` (not variableIndices) so the effect doesn't refire on
  // every render — useMemo returns a new array identity each time.
  useEffect(() => {
    setVars(new Array(variableIndices.length).fill(''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const onSelect = useCallback((t: TemplateRow) => {
    setSelected(t)
  }, [])

  const onSend = useCallback(async () => {
    if (!selected || sending) return

    // Validate that every detected variable has a value. WhatsApp will
    // reject empty body params anyway, so fail fast in the UI.
    if (variableIndices.length > 0 && vars.some((v) => !v.trim())) {
      toast.error('Preencha todas as variáveis do template.')
      return
    }

    const components: Array<Record<string, unknown>> = []
    if (variableIndices.length > 0) {
      components.push({
        type: 'body',
        parameters: vars.map((v) => ({ type: 'text', text: v })),
      })
    }

    setSending(true)
    try {
      const r = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          type: 'template',
          template: {
            name: selected.template_name,
            language: selected.language ?? 'pt_BR',
            components,
          },
        }),
      })

      if (r.ok) {
        toast.success(`Template "${selected.template_name}" enviado.`)
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
      setSending(false)
    }
  }, [selected, sending, variableIndices.length, vars, conversationId, onClose])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {selected ? selected.template_name : 'Selecionar template'}
          </DialogTitle>
          <DialogDescription>
            {selected
              ? 'Preencha as variáveis e envie.'
              : 'Templates aprovados desta WABA.'}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Carregando...
              </div>
            ) : templates.length === 0 ? (
              <div className="py-8 text-center font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Nenhum template aprovado encontrado.
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {templates.map((t) => (
                  <li key={`${t.template_name}-${t.language ?? ''}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(t)}
                      className="flex w-full flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {t.template_name}
                        </span>
                        {t.language && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] uppercase tracking-wider"
                          >
                            {t.language}
                          </Badge>
                        )}
                        {t.category && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] uppercase tracking-wider"
                          >
                            {t.category}
                          </Badge>
                        )}
                      </div>
                      {t.body_text && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {t.body_text.slice(0, 80)}
                          {t.body_text.length > 80 ? '…' : ''}
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setSelected(null)}
              className="self-start"
            >
              <ArrowLeft />
              Voltar
            </Button>

            {selected.body_text && (
              <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs whitespace-pre-wrap text-foreground">
                {renderPreview(selected.body_text, variableIndices, vars)}
              </div>
            )}

            {variableIndices.length === 0 ? (
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Este template não tem variáveis.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {variableIndices.map((idx, i) => (
                  <label key={idx} className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Variável {`{{${idx}}}`}
                    </span>
                    <Input
                      value={vars[i] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        setVars((prev) => {
                          const next = prev.slice()
                          next[i] = v
                          return next
                        })
                      }}
                      placeholder={`Valor para {{${idx}}}`}
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={sending}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={onSend}
                disabled={sending}
              >
                {sending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Send />
                )}
                Enviar template
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Extract `{{N}}` placeholder indices from a template's body. Falls back
 * to the `components` jsonb if the convenience `body_text` column is null.
 * Returns a sorted, deduplicated list — e.g. body containing "{{2}} oi
 * {{1}}" returns [1, 2].
 */
function extractVariables(t: TemplateRow): number[] {
  const scan = (s: string): number[] => {
    const found = new Set<number>()
    const re = /\{\{(\d+)\}\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s)) !== null) {
      const n = Number(m[1])
      if (Number.isFinite(n)) found.add(n)
    }
    return Array.from(found).sort((a, b) => a - b)
  }

  if (t.body_text) return scan(t.body_text)

  // Fallback: introspect components for a BODY entry with `.text`.
  const comps = t.components as Array<{ type?: string; text?: string }> | null
  if (Array.isArray(comps)) {
    const body = comps.find(
      (c) => typeof c?.type === 'string' && c.type.toUpperCase() === 'BODY',
    )
    if (body?.text) return scan(body.text)
  }
  return []
}

/**
 * Replace `{{N}}` placeholders in a preview string with the operator's
 * inputs (or keep the placeholder if not yet filled).
 */
function renderPreview(
  body: string,
  indices: number[],
  values: string[],
): string {
  const map = new Map<number, string>()
  indices.forEach((idx, i) => {
    const v = values[i]
    if (v && v.trim()) map.set(idx, v)
  })
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const n = Number(raw)
    return map.get(n) ?? `{{${raw}}}`
  })
}
