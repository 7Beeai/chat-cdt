'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  ChevronsLeft,
  // Desativados temporariamente junto com as telas Templates/Filas:
  // LayoutTemplate,
  // ListTodo,
  LogOut,
  MessageCircle,
  Shield,
} from 'lucide-react'

import { signOut } from '@/app/login/actions'
import { UnitSelect } from '@/components/inbox/unit-select'
import { cn } from '@/lib/utils'

export type SidebarUser = {
  id: string
  name: string
}

type NavItem = {
  href: string
  label: string
  icon: typeof MessageCircle
  badge?: number
  soon?: boolean
}

export function Sidebar({
  user,
  waitingCount = 0,
  isAdmin = false,
  collapsed = false,
  onToggleCollapse,
  onNavigate,
}: {
  user: SidebarUser | null
  waitingCount?: number
  isAdmin?: boolean
  /** Desktop icon-rail mode. Always expanded inside the mobile drawer. */
  collapsed?: boolean
  /** When provided, renders the desktop collapse toggle. */
  onToggleCollapse?: () => void
  /** Called when a nav link is followed (used to close the mobile drawer). */
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const displayName = user?.name ?? 'Operador'
  const initial = displayName.trim().charAt(0).toUpperCase() || 'O'

  const nav: NavItem[] = [
    {
      href: '/inbox',
      label: 'Inbox',
      icon: MessageCircle,
      badge: waitingCount > 0 ? waitingCount : undefined,
    },
    // Desativado temporariamente — restaurar quando a tela for retomada:
    // { href: '/templates', label: 'Templates', icon: LayoutTemplate },
    ...(isAdmin
      ? [{ href: '/admin/users', label: 'Usuários', icon: Shield }]
      : []),
    { href: '/reports', label: 'Relatórios', icon: BarChart3 },
    // Desativado temporariamente — restaurar quando a tela for retomada:
    // { href: '#filas', label: 'Filas', icon: ListTodo, soon: true },
  ]

  return (
    <aside className="relative flex h-full w-full flex-col overflow-hidden border-r border-border bg-background">
      {/* Brand */}
      <div
        className={cn(
          'px-[18px] pb-3.5 pt-[18px]',
          collapsed && 'flex flex-col items-center px-0',
        )}
      >
        <div className={cn('flex items-center gap-[7px]', collapsed && 'gap-0')}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bee.gif"
            alt=""
            aria-hidden
            className={cn('size-4 shrink-0 object-contain', collapsed && 'size-5')}
          />
          {!collapsed && (
            <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-accent">
              7Bee.AI · Chat-CDT
            </span>
          )}
        </div>
        {!collapsed && (
          <div className="mt-2 text-[17px] font-bold tracking-[-0.02em] text-foreground">
            Atendimento
          </div>
        )}
      </div>

      {/* Unit selector — single source of the unit filter (hidden in the rail) */}
      {!collapsed && (
        <div className="px-3 pb-3.5">
          <UnitSelect />
        </div>
      )}

      {/* Navigation */}
      <nav className={cn('px-3', collapsed && 'px-2')}>
        {!collapsed && (
          <span className="block px-2 pb-1.5 pt-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Navegação
          </span>
        )}
        <div className="flex flex-col gap-0.5">
          {nav.map((item) => {
            const Icon = item.icon
            const active =
              !item.soon &&
              (pathname === item.href ||
                pathname.startsWith(`${item.href}/`))

            if (item.soon) {
              return (
                <span
                  key={item.href}
                  title={collapsed ? `${item.label} — em breve` : 'Em breve'}
                  className={cn(
                    'flex cursor-default items-center gap-2.5 rounded-[9px] px-[11px] py-[9px] text-[13.5px] font-medium text-muted-foreground/45',
                    collapsed && 'justify-center px-0',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground/40">
                        em breve
                      </span>
                    </>
                  )}
                </span>
              )
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'relative flex items-center gap-2.5 rounded-[9px] px-[11px] py-[9px] text-[13.5px] transition-colors',
                  collapsed && 'justify-center px-0',
                  active
                    ? 'bg-accent font-semibold text-accent-foreground'
                    : 'font-medium text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {collapsed ? (
                  item.badge ? (
                    <span
                      className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent"
                      aria-hidden
                    />
                  ) : null
                ) : (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {item.badge ? (
                      <span
                        className={cn(
                          'font-mono text-[10px] font-bold tabular-nums',
                          active
                            ? 'text-accent-foreground/65'
                            : 'text-muted-foreground',
                        )}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </>
                )}
              </Link>
            )
          })}
        </div>
      </nav>

      <div className="flex-1" />

      {/* Collapse toggle — desktop inline only */}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          className={cn(
            'mx-3 mb-1 flex items-center gap-2.5 rounded-[9px] px-[11px] py-[9px] text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
            collapsed && 'mx-2 justify-center px-0',
          )}
        >
          <ChevronsLeft
            className={cn('size-4 shrink-0 transition-transform', collapsed && 'rotate-180')}
          />
          {!collapsed && <span className="flex-1 text-left">Recolher</span>}
        </button>
      )}

      {/* User footer */}
      <div
        className={cn(
          'border-t border-border px-4 py-3.5',
          collapsed && 'flex flex-col items-center px-0',
        )}
      >
        <div className={cn('flex items-center gap-2.5', collapsed && 'gap-0')}>
          <div
            className="flex size-[30px] shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/12 text-xs font-bold text-accent"
            title={collapsed ? displayName : undefined}
          >
            {initial}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-foreground">
                {displayName}
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="live-dot size-[5px] rounded-full bg-accent"
                  aria-hidden
                />
                <span className="font-mono text-[10px] text-accent">
                  Conectado
                </span>
              </div>
            </div>
          )}
        </div>
        <form action={signOut}>
          <button
            type="submit"
            title={collapsed ? 'Sair' : undefined}
            aria-label="Sair"
            className={cn(
              'mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground transition-colors hover:text-destructive',
              collapsed && 'mt-2 justify-center',
            )}
          >
            <LogOut className="size-3.5" />
            {!collapsed && 'Sair'}
          </button>
        </form>
      </div>
    </aside>
  )
}
