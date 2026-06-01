'use client'

import { Search } from 'lucide-react'

import { InboxRow } from '@/app/(app)/inbox/inbox-row'
import {
  HANDOFF_LABEL,
  type ConversationListItem,
  type HandoffReason,
  type InboxTab,
} from '@/app/(app)/inbox/list-data'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

import { BulkActionBar } from './bulk-action-bar'
import { FilterSelect } from './filter-select'
import { FilterTabs } from './filter-tabs'
import { QueueVitals } from './queue-vitals'

export function InboxListColumn({
  rows,
  counts,
  vitals,
  tab,
  onTab,
  search,
  onSearch,
  reasonFilter,
  onReasonFilter,
  operatorFilter,
  onOperatorFilter,
  operators,
  currentUserId,
  operatorNames,
  activeId,
  selectedIds,
  onToggleSelect,
  onClearSelection,
  onBulkAssign,
  onBulkClose,
}: {
  rows: ConversationListItem[]
  counts: Record<InboxTab, number>
  vitals: { waiting: number; breached: number; active: number }
  tab: InboxTab
  onTab: (t: InboxTab) => void
  search: string
  onSearch: (s: string) => void
  reasonFilter: HandoffReason | 'all'
  onReasonFilter: (r: HandoffReason | 'all') => void
  operatorFilter: string | 'all'
  onOperatorFilter: (id: string | 'all') => void
  operators: { id: string; name: string }[]
  currentUserId: string
  operatorNames: Record<string, string>
  activeId: string | null
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onClearSelection: () => void
  onBulkAssign: () => void
  onBulkClose: () => void
}) {
  const reasonOptions = [
    { value: 'all', label: 'Todos os motivos' },
    ...(Object.keys(HANDOFF_LABEL) as HandoffReason[]).map((r) => ({
      value: r,
      label: HANDOFF_LABEL[r],
    })),
  ]
  const operatorOptions = [
    { value: 'all', label: 'Todos os operadores' },
    ...operators.map((o) => ({
      value: o.id,
      label: o.id === currentUserId ? `${o.name} (eu)` : o.name,
    })),
  ]
  return (
    <div
      className={cn(
        'w-full shrink-0 flex-col border-r border-border bg-background lg:w-[360px] xl:w-[400px]',
        // Compact: show the list only when no conversation is open; the thread
        // takes over full-width once one is selected. Both show side-by-side at lg+.
        activeId ? 'hidden lg:flex' : 'flex',
      )}
    >
      {/* Header */}
      <div className="shrink-0 px-[18px] pt-4">
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-foreground">
              Inbox
            </h1>
            <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              {rows.length} {rows.length === 1 ? 'conversa' : 'conversas'}
            </span>
          </div>

          <QueueVitals
            waiting={vitals.waiting}
            breached={vitals.breached}
            active={vitals.active}
          />

          <FilterTabs tab={tab} onTab={onTab} counts={counts} />

          {/* Secondary filters: reason + operator (custom dropdowns) */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <FilterSelect
              ariaLabel="Filtrar por motivo"
              value={reasonFilter}
              options={reasonOptions}
              onChange={(v) => onReasonFilter(v as HandoffReason | 'all')}
            />
            {operators.length > 0 && (
              <FilterSelect
                ariaLabel="Filtrar por operador"
                value={operatorFilter}
                options={operatorOptions}
                onChange={onOperatorFilter}
              />
            )}
          </div>

          {/* Search */}
          <div className="relative pb-3 pt-3.5">
            <Search
              className="pointer-events-none absolute left-2.5 top-[calc(50%-2px)] size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar nome, telefone, unidade…"
              className="w-full rounded-lg border border-border bg-transparent py-1.5 pl-8 pr-3 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-accent/40"
            />
          </div>
        </div>
      </div>

      {/* Bulk bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          onAssign={onBulkAssign}
          onClose={onBulkClose}
          onClear={onClearSelection}
        />
      )}

      {/* Rows */}
      <ScrollArea className="min-h-0 flex-1">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-[13px] text-muted-foreground">
            Nenhuma conversa neste filtro.
          </div>
        ) : (
          <ul className="flex flex-col">
            {rows.map((c) => (
              <li key={c.id}>
                <InboxRow
                  conv={c}
                  isActive={c.id === activeId}
                  selected={selectedIds.has(c.id)}
                  onToggleSelect={onToggleSelect}
                  currentUserId={currentUserId}
                  operatorNames={operatorNames}
                />
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
