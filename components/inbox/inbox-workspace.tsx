'use client'

import { usePathname, useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react'
import { toast } from 'sonner'

import { bulkAssignToMe, bulkClose } from '@/app/(app)/inbox/[id]/actions'
import {
  INBOX_TABS,
  isHandoffMember,
  matchesOperator,
  matchesReason,
  matchesSearch,
  matchesTab,
  matchesTrilho,
  sortItems,
  type ConversationListItem,
  type ConversationRow,
  type HandoffReason,
  type InboxTab,
  type Trilho,
  type UnitVitals,
} from '@/app/(app)/inbox/list-data'
import { extractPreview } from '@/app/(app)/inbox/preview'
import type { CloseOutcome } from '@/app/(app)/inbox/outcomes'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

import { HexagonPattern } from '@/components/ui/hexagon-pattern'

import { CloseDialog } from './close-dialog'
import { InboxListColumn } from './inbox-list-column'
import { useUnitFilter } from './unit-filter'

type MessageRow = {
  id: string
  conversation_id: string
  payload: Record<string, unknown> | null
  direction: 'in' | 'out'
  created_at: string
  type: string | null
}

/**
 * Land on the most useful non-empty tab: Aguardando first (work to grab),
 * then Meus, then Equipe, then Encerrados.
 */
function pickDefaultTab(
  items: ConversationListItem[],
  currentUserId: string | null,
): InboxTab {
  for (const t of INBOX_TABS) {
    if (items.some((c) => matchesTab(c, t.value, currentUserId))) return t.value
  }
  return 'waiting'
}

export function InboxWorkspace({
  initial,
  currentUserId,
  operatorNames = {},
  vitalsByUnit = [],
  serverNow,
  children,
}: {
  initial: ConversationListItem[]
  currentUserId: string
  operatorNames?: Record<string, string>
  vitalsByUnit?: UnitVitals[]
  /** Date.now() captured on the server, so the first client render agrees with
   * the SSR HTML on time-relative labels (avoids the hydration mismatch). */
  serverNow: number
  children: React.ReactNode
}) {
  const [items, setItems] = useState<ConversationListItem[]>(initial)
  const [tab, setTab] = useState<InboxTab>(() =>
    pickDefaultTab(initial, currentUserId),
  )
  const [search, setSearch] = useState('')
  const [reasonFilter, setReasonFilter] = useState<HandoffReason | 'all'>('all')
  const [trilhoFilter, setTrilhoFilter] = useState<Trilho | 'all'>('all')
  const [operatorFilter, setOperatorFilter] = useState<string | 'all'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkCloseOpen, setBulkCloseOpen] = useState(false)
  const [now, setNow] = useState(serverNow)
  const [isBulkPending, startTransition] = useTransition()

  const router = useRouter()
  const pathname = usePathname()
  const { selectedUnitId } = useUnitFilter()

  // Server data is authoritative on (re)entry / refresh.
  useEffect(() => {
    setItems(initial)
  }, [initial])

  // Low-frequency ticker so SLA tones + relative times advance. We START from
  // the server's `now` (so the first client render matches the SSR HTML), then
  // jump to the real client clock AFTER mount — past hydration, so no mismatch.
  // 30s matches the thread header cadence.
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const activeId = useMemo(() => {
    const m = /^\/inbox\/([^/]+)/.exec(pathname)
    return m ? m[1] : null
  }, [pathname])

  // -- Realtime: keep the handoff working set in sync ------------------------
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('inbox-workspace')
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
          const next = payload.new as ConversationRow | null
          if (!next) return
          const member = isHandoffMember(next)
          setItems((curr) => {
            const idx = curr.findIndex((c) => c.id === next.id)
            // Not (or no longer) a handoff — drop it if present (e.g. returned
            // to AI, or a brand-new AI conversation we never want to show).
            if (!member) {
              return idx === -1 ? curr : curr.filter((c) => c.id !== next.id)
            }
            if (idx === -1) {
              // Just became a handoff. Stub it (realtime payload lacks joins);
              // a navigation/refresh fills contact/unit from the server.
              const stub: ConversationListItem = {
                id: next.id,
                unit_id: next.unit_id,
                status: next.status,
                routing: next.routing,
                handoff_reason: next.handoff_reason,
                priority: next.priority,
                last_inbound_at: next.last_inbound_at,
                customer_window_expires_at: next.customer_window_expires_at,
                assigned_operator_id: next.assigned_operator_id,
                contact: null,
                unit: null,
                preview: null,
              }
              return sortItems([stub, ...curr])
            }
            // NB: `contact` is intentionally NOT merged from the realtime
            // payload — it carries the raw WhatsApp profile name, and the
            // server already resolved contact.name to the validated CRM name
            // (see inbox/layout.tsx + migration 0013). Merging it here would
            // silently revert displayed names to the WhatsApp garbage.
            const merged: ConversationListItem = {
              ...curr[idx],
              unit_id: next.unit_id,
              status: next.status,
              routing: next.routing,
              handoff_reason: next.handoff_reason,
              priority: next.priority,
              last_inbound_at: next.last_inbound_at,
              customer_window_expires_at: next.customer_window_expires_at,
              assigned_operator_id: next.assigned_operator_id,
            }
            const copy = [...curr]
            copy[idx] = merged
            return sortItems(copy)
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
            return sortItems(copy)
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // -- Derived: per-unit set, tab counts, vitals, visible rows ---------------
  const unitScoped = useMemo(
    () =>
      selectedUnitId
        ? items.filter((c) => c.unit_id === selectedUnitId)
        : items,
    [items, selectedUnitId],
  )

  const counts = useMemo(() => {
    const c: Record<InboxTab, number> = {
      waiting: 0,
      mine: 0,
      team: 0,
      closed: 0,
    }
    for (const it of unitScoped) {
      for (const t of INBOX_TABS) {
        if (matchesTab(it, t.value, currentUserId)) c[t.value]++
      }
    }
    return c
  }, [unitScoped, currentUserId])

  // True queue vitals come from the server (chat_inbox_vitals), NOT the capped
  // working set — otherwise the counter pins at the .limit(300) ceiling and
  // disagrees with Relatórios. Re-aggregate per the selected unit (or all).
  // Snapshot as of page load; it does not tick live (the backlog barely moves
  // second-to-second and a correct snapshot beats a live-but-wrong number).
  const vitals = useMemo(() => {
    const scope = selectedUnitId
      ? vitalsByUnit.filter((v) => v.unit_id === selectedUnitId)
      : vitalsByUnit
    return scope.reduce(
      (acc, v) => ({
        waiting: acc.waiting + v.waiting,
        breached: acc.breached + v.breached,
        active: acc.active + v.active,
      }),
      { waiting: 0, breached: 0, active: 0 },
    )
  }, [vitalsByUnit, selectedUnitId])

  // Operators present in the current unit scope (for the operator filter).
  const operators = useMemo(() => {
    const ids = new Set<string>()
    for (const it of unitScoped) {
      if (it.assigned_operator_id) ids.add(it.assigned_operator_id)
    }
    return Array.from(ids)
      .map((id) => ({ id, name: operatorNames[id] ?? 'Operador' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [unitScoped, operatorNames])

  const rows = useMemo(
    () =>
      sortItems(
        unitScoped.filter(
          (c) =>
            matchesTab(c, tab, currentUserId) &&
            matchesSearch(c, search) &&
            matchesReason(c, reasonFilter) &&
            matchesTrilho(c, trilhoFilter) &&
            matchesOperator(c, operatorFilter),
        ),
      ),
    [unitScoped, tab, search, reasonFilter, trilhoFilter, operatorFilter, currentUserId],
  )

  // -- Keyboard J/K navigation within the visible rows -----------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const k = e.key
      if (k !== 'j' && k !== 'k' && k !== 'ArrowDown' && k !== 'ArrowUp') return
      if (rows.length === 0) return
      e.preventDefault()
      const idx = rows.findIndex((r) => r.id === activeId)
      const dir = k === 'j' || k === 'ArrowDown' ? 1 : -1
      const nextIdx =
        idx === -1
          ? dir === 1
            ? 0
            : rows.length - 1
          : Math.min(Math.max(idx + dir, 0), rows.length - 1)
      const target = rows[nextIdx]
      if (target) router.push(`/inbox/${target.id}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, activeId, router])

  // -- Selection -------------------------------------------------------------
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const runBulk = useCallback(
    (label: string, action: (ids: string[]) => Promise<{ error?: string }>) => {
      const ids = Array.from(selectedIds)
      if (ids.length === 0) return
      startTransition(async () => {
        const r = await action(ids)
        if (r?.error) toast.error(`${label}: ${r.error}`)
        else toast.success(`${label} (${ids.length})`)
        clearSelection()
      })
    },
    [selectedIds, clearSelection],
  )

  const confirmBulkClose = useCallback(
    (outcome: CloseOutcome) => {
      const ids = Array.from(selectedIds)
      if (ids.length === 0) return
      startTransition(async () => {
        const r = await bulkClose(ids, outcome)
        if (r?.error) toast.error(`Encerradas: ${r.error}`)
        else toast.success(`Encerradas (${ids.length})`)
        setBulkCloseOpen(false)
        clearSelection()
      })
    },
    [selectedIds, clearSelection],
  )

  return (
    <div className="flex min-h-0 flex-1">
      <InboxListColumn
        rows={rows}
        now={now}
        // "Aguardando" tab badge shares the waiting vital's definition, so use
        // the real (uncapped) count for it too; mine/team/closed stay
        // client-derived (accurate at current volumes).
        counts={{ ...counts, waiting: vitals.waiting }}
        vitals={vitals}
        tab={tab}
        onTab={setTab}
        search={search}
        onSearch={setSearch}
        reasonFilter={reasonFilter}
        onReasonFilter={setReasonFilter}
        trilhoFilter={trilhoFilter}
        onTrilhoFilter={setTrilhoFilter}
        operatorFilter={operatorFilter}
        onOperatorFilter={setOperatorFilter}
        operators={operators}
        currentUserId={currentUserId}
        operatorNames={operatorNames}
        activeId={activeId}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onClearSelection={clearSelection}
        onBulkAssign={() => runBulk('Atribuídas a você', bulkAssignToMe)}
        onBulkClose={() => setBulkCloseOpen(true)}
      />
      <section
        className={cn(
          'relative min-w-0 flex-1 overflow-hidden',
          // Compact: the thread region is hidden until a conversation is open
          // (the list owns the screen). Always visible at lg+.
          activeId ? 'flex' : 'hidden lg:flex',
        )}
      >
        {/* Hexagon grid backdrop for the thread canvas — same motif as /login
            but fainter (/0.07 vs /0.12) so it textures the empty state and the
            chat background without competing with messages. Absolute layer sits
            behind {children}, which is lifted with z-[1]. */}
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

      <CloseDialog
        open={bulkCloseOpen}
        onOpenChange={setBulkCloseOpen}
        count={selectedIds.size}
        pending={isBulkPending}
        onConfirm={confirmBulkClose}
      />
    </div>
  )
}
