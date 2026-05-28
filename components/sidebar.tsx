'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutTemplate, LogOut, MessageSquare } from 'lucide-react'

import { signOut } from '@/app/login/actions'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type SidebarUser = {
  id: string
  name: string
}

const NAV_ITEMS = [
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/templates', label: 'Templates', icon: LayoutTemplate },
] as const

export function Sidebar({ user }: { user: SidebarUser | null }) {
  const pathname = usePathname()
  const displayName = user?.name ?? 'Operador'
  const initial = displayName.trim().charAt(0).toUpperCase() || 'O'

  return (
    <aside className="relative flex h-screen w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-card">
      <div className="elegant-divider px-5 py-6">
        <span className="block font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
          7Bee.AI · CHAT-CDT
        </span>
        <span className="mt-1 block gradient-text text-base font-semibold tracking-tight">
          Atendimento
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-5">
        <span className="px-3 mb-2 text-[10px] font-mono uppercase tracking-[1.5px] text-muted-foreground">
          Navegação
        </span>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent text-accent-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto border-t border-border px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-foreground">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm text-foreground">
              {displayName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              Conectado
            </span>
          </div>
        </div>
        <form action={signOut}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="mt-3 w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-4" />
            Sair
          </Button>
        </form>
      </div>
    </aside>
  )
}
