'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type InboxTab = 'queued' | 'mine' | 'all' | 'closed'

export type UnitOption = { id: string; code: string; name: string }

const TABS: { value: InboxTab; label: string }[] = [
  { value: 'queued', label: 'Aguardando' },
  { value: 'mine', label: 'Meus' },
  { value: 'all', label: 'Todos' },
  { value: 'closed', label: 'Encerrados' },
]

const ALL_UNITS = '__all__'

export function TabsBar({
  value,
  units,
  selectedUnitId,
}: {
  value: InboxTab
  units: UnitOption[]
  selectedUnitId: string | null
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  function navigate(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    startTransition(() => {
      router.push(qs ? `/inbox?${qs}` : '/inbox')
    })
  }

  function handleTabChange(next: unknown) {
    if (next == null) return
    const nextStr = String(next)
    if (nextStr === value) return
    navigate({ tab: nextStr })
  }

  function handleUnitChange(next: unknown) {
    const nextStr = next == null ? ALL_UNITS : String(next)
    navigate({ unit: nextStr === ALL_UNITS ? null : nextStr })
  }

  const selectedLabel =
    selectedUnitId == null
      ? 'Todas as unidades'
      : units.find((u) => u.id === selectedUnitId)?.name ??
        'Todas as unidades'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={value} onValueChange={handleTabChange} className="w-fit">
        <TabsList className="bg-secondary/70">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground data-active:bg-accent data-active:text-accent-foreground data-active:shadow-sm dark:data-active:bg-accent dark:data-active:text-accent-foreground"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {units.length > 1 ? (
        <Select
          value={selectedUnitId ?? ALL_UNITS}
          onValueChange={handleUnitChange}
        >
          <SelectTrigger className="h-8 min-w-[200px] text-xs">
            {/* Render direto o label legível — Base UI Select.Value mostra
                o raw value por default e seria confuso. */}
            <span className="line-clamp-1 text-left">{selectedLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_UNITS}>Todas as unidades</SelectItem>
            {units.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  )
}
