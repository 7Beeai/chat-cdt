'use client'

import { Search } from 'lucide-react'

import { InboxRow } from '@/app/(app)/inbox/inbox-row'
import type {
  ConversationListItem,
  InboxTab,
} from '@/app/(app)/inbox/list-data'
import { ScrollArea } from '@/components/ui/scroll-area'

import { BulkActionBar } from './bulk-action-bar'
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
  activeId: string | null
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onClearSelection: () => void
  onBulkAssign: () => void
  onBulkClose: () => void
}) {
  return (
    <div className="flex w-[360px] shrink-0 flex-col border-r border-border bg-background xl:w-[400px]">
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
                />
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
