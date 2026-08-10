'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'

import {
  VENDAS_TABS,
  lastActivityOf,
  matchesVendasSearch,
  matchesVendasTab,
  sortVendas,
  type VendasConversationRow,
  type VendasListItem,
  type VendasTab,
} from '@/app/(app)/vendas/list-data'
import { extractPreview } from '@/app/(app)/inbox/preview'
import { createClient } from '@/lib/supabase/client'
import { ensureRealtimeAuth } from '@/lib/supabase/realtime'
import { cn } from '@/lib/utils'

import { HexagonPattern } from '@/components/ui/hexagon-pattern'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useUnitFilter } from '@/components/inbox/unit-filter'

import { VendasRow } from './vendas-row'

type MessageRow = {
  id: string
  conversation_id: string
  payload: Record<string, unknown> | null
  direction: 'in' | 'out'
  created_at: string
  type: string | null
}

/**
 * Monitor ao vivo do trilho de VENDAS (Josi). Mesma anatomia da inbox, sem
 * ações em massa nem posse: o objetivo é ASSISTIR a IA vendendo em tempo real.
 *
 * Sincronização em 3 camadas (mesmo padrão da inbox):
 *  1. realtime de conversations (INSERT/UPDATE) filtrado por pertencimento
 *     (phone_number_id ∈ números de vendas) — conversa nova entra como stub e
 *     um router.refresh() debounced preenche contato/unidade/preview;
 *  2. realtime de messages (INSERT) atualiza preview + reordena;
 *  3. polling de fallback (60s, aba visível) — realtime é acelerador, não
 *     dependência.
 */
export function VendasWorkspace({
  initial,
  phoneRowIds,
  serverNow,
  children,
}: {
  initial: VendasListItem[]
  /** uuids de chat_phone_numbers que são números de vendas (teste de pertencimento). */
  phoneRowIds: string[]
  /** Date.now() do servidor — primeira render do cliente casa com o SSR. */
  serverNow: number
  children: React.ReactNode
}) {
  const [items, setItems] = useState<VendasListItem[]>(initial)
  const [tab, setTab] = useState<VendasTab>('ia')
  const [search, setSearch] = useState('')
  const [now, setNow] = useState(serverNow)

  const router = useRouter()
  const pathname = usePathname()
  const { selectedUnitId } = useUnitFilter()

  const phoneRowSet = useMemo(() => new Set(phoneRowIds), [phoneRowIds])

  // Server data is authoritative on (re)entry / refresh.
  useEffect(() => {
    setItems(initial)
  }, [initial])

  // Ticker de 30s pros rótulos relativos ("há 2m") andarem.
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const activeId = useMemo(() => {
    const m = /^\/vendas\/([^/]+)/.exec(pathname)
    return m ? m[1] : null
  }, [pathname])

  // refresh debounced: conversa nova chega como stub sem joins; o refresh
  // re-executa o layout no servidor e preenche contato/unidade/preview/estado.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [])
  function scheduleRefresh() {
    if (refreshTimer.current) return
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      if (document.visibilityState === 'visible') router.refresh()
    }, 2_500)
  }

  // -- Realtime ---------------------------------------------------------------
  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    // setAuth ANTES do subscribe — sem isso a subscription nasce com claims
    // anon e a RLS filtra todos os eventos (ver lib/supabase/realtime.ts).
    void ensureRealtimeAuth(supabase).then(() => {
      if (cancelled) return
      channel = supabase
        .channel('vendas-workspace')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'conversations' },
          (payload) => {
            const eventType = payload.eventType as
              | 'INSERT'
              | 'UPDATE'
              | 'DELETE'
            if (eventType === 'DELETE') {
              const old = payload.old as { id?: string } | null
              if (old?.id) setItems((c) => c.filter((x) => x.id !== old.id))
              return
            }
            const next = payload.new as VendasConversationRow | null
            if (!next) return
            const member =
              !!next.phone_number_id && phoneRowSet.has(next.phone_number_id)
            setItems((curr) => {
              const idx = curr.findIndex((c) => c.id === next.id)
              if (!member) {
                return idx === -1 ? curr : curr.filter((c) => c.id !== next.id)
              }
              if (idx === -1) {
                // Conversa de vendas nova (lead escreveu agora, ou a Josi
                // abriu via chat_record_outbound_message). Stub + refresh.
                scheduleRefresh()
                const stub: VendasListItem = {
                  id: next.id,
                  unit_id: next.unit_id,
                  status: next.status,
                  routing: next.routing,
                  handoff_reason: next.handoff_reason,
                  priority: next.priority,
                  last_inbound_at: next.last_inbound_at,
                  customer_window_expires_at: next.customer_window_expires_at,
                  assigned_operator_id: next.assigned_operator_id,
                  phone_number_id: next.phone_number_id,
                  contact: null,
                  unit: null,
                  preview: null,
                  estado: null,
                }
                return sortVendas([stub, ...curr])
              }
              const merged: VendasListItem = {
                ...curr[idx],
                unit_id: next.unit_id,
                status: next.status,
                routing: next.routing,
                handoff_reason: next.handoff_reason,
                priority: next.priority,
                last_inbound_at: next.last_inbound_at,
                customer_window_expires_at: next.customer_window_expires_at,
                assigned_operator_id: next.assigned_operator_id,
                phone_number_id: next.phone_number_id,
              }
              const copy = [...curr]
              copy[idx] = merged
              return sortVendas(copy)
            })
          },
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            const msg = payload.new as MessageRow | null
            if (!msg) return
            setItems((curr) => {
              const idx = curr.findIndex((c) => c.id === msg.conversation_id)
              if (idx === -1) return curr
              const { text, kind } = extractPreview(msg.payload, msg.type)
              const copy = [...curr]
              copy[idx] = {
                ...curr[idx],
                preview: {
                  text,
                  kind,
                  direction: msg.direction,
                  createdAt: msg.created_at,
                },
                last_inbound_at:
                  msg.direction === 'in'
                    ? msg.created_at
                    : curr[idx].last_inbound_at,
              }
              return sortVendas(copy)
            })
          },
        )
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[vendas-workspace] realtime channel', status, err)
          }
        })
    })

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneRowSet])

  // -- Polling de fallback (60s, aba visível) ---------------------------------
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    const t = setInterval(refreshIfVisible, 60_000)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [router])

  // -- Derivados --------------------------------------------------------------
  const unitScoped = useMemo(
    () =>
      selectedUnitId
        ? items.filter((c) => c.unit_id === selectedUnitId)
        : items,
    [items, selectedUnitId],
  )

  const counts = useMemo(() => {
    const c: Record<VendasTab, number> = {
      ia: 0,
      humano: 0,
      encerradas: 0,
      todas: 0,
    }
    for (const it of unitScoped) {
      for (const t of VENDAS_TABS) {
        if (matchesVendasTab(it, t.value)) c[t.value]++
      }
    }
    return c
  }, [unitScoped])

  const rows = useMemo(
    () =>
      sortVendas(
        unitScoped.filter(
          (c) => matchesVendasTab(c, tab) && matchesVendasSearch(c, search),
        ),
      ),
    [unitScoped, tab, search],
  )

  // Última atividade em qualquer conversa de vendas — o "pulso" da área.
  const lastPulse = useMemo(() => {
    let max = 0
    for (const it of unitScoped) max = Math.max(max, lastActivityOf(it))
    return max
  }, [unitScoped])

  return (
    <div className="flex min-h-0 flex-1">
      {/* Coluna da lista */}
      <div
        className={cn(
          'w-full shrink-0 flex-col border-r border-border bg-background lg:w-[360px] xl:w-[400px]',
          activeId ? 'hidden lg:flex' : 'flex',
        )}
      >
        <div className="shrink-0 px-[18px] pt-4">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-foreground">
              Vendas
            </h1>
            <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              {rows.length} {rows.length === 1 ? 'conversa' : 'conversas'}
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-accent">
              <span className="live-dot size-[5px] rounded-full bg-accent" />
              ao vivo
            </span>
          </div>

          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            Conversas da IA de vendas (Josi), em tempo real.
            {lastPulse > 0 && ' Toda a frota, somente leitura.'}
          </p>

          {/* Tabs */}
          <div className="mt-3.5 flex flex-wrap gap-1">
            {VENDAS_TABS.map((t) => {
              const active = t.value === tab
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTab(t.value)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] transition-colors',
                    active
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      'tabular-nums',
                      active ? 'opacity-60' : 'opacity-80',
                    )}
                  >
                    {counts[t.value]}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Busca */}
          <div className="relative pb-3 pt-3.5">
            <Search
              className="pointer-events-none absolute left-2.5 top-[calc(50%-2px)] size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nome, telefone, unidade…"
              className="w-full rounded-lg border border-border bg-transparent py-1.5 pl-8 pr-3 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-accent/40"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {rows.length === 0 ? (
            <div className="px-6 py-16 text-center text-[13px] text-muted-foreground">
              {items.length === 0
                ? 'Nenhuma conversa de vendas ainda. Assim que um lead escrever para um número de vendas, ele aparece aqui ao vivo.'
                : 'Nenhuma conversa neste filtro.'}
            </div>
          ) : (
            <ul className="flex flex-col">
              {rows.map((c) => (
                <li key={c.id}>
                  <VendasRow conv={c} now={now} isActive={c.id === activeId} />
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>

      {/* Região da thread */}
      <section
        className={cn(
          'relative min-w-0 flex-1 overflow-hidden',
          activeId ? 'flex' : 'hidden lg:flex',
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden [mask-image:radial-gradient(ellipse_80%_70%_at_50%_40%,black,transparent_85%)]"
        >
          <HexagonPattern
            radius={36}
            className="stroke-[hsl(83_79%_60%/0.04)] fill-none"
          />
        </div>
        <div className="relative z-[1] flex min-h-0 min-w-0 flex-1">
          {children}
        </div>
      </section>
    </div>
  )
}
