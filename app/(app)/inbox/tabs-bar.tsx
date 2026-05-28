'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type InboxTab = 'queued' | 'mine' | 'all' | 'closed'

const TABS: { value: InboxTab; label: string }[] = [
  { value: 'queued', label: 'Aguardando' },
  { value: 'mine', label: 'Meus' },
  { value: 'all', label: 'Todos' },
  { value: 'closed', label: 'Encerrados' },
]

export function TabsBar({ value }: { value: InboxTab }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  function handleChange(next: unknown) {
    if (next == null) return
    const nextStr = String(next)
    if (nextStr === value) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', nextStr)
    startTransition(() => {
      router.push(`/inbox?${params.toString()}`)
    })
  }

  return (
    <Tabs value={value} onValueChange={handleChange} className="w-fit">
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
  )
}
