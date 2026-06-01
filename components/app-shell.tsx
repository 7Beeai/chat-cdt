'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'

import { PushSetup } from '@/components/push-setup'
import { Sidebar, type SidebarUser } from '@/components/sidebar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const COLLAPSE_KEY = 'chat-cdt:sidebar-collapsed'

/**
 * Client shell around the sidebar + main column.
 *
 * - Desktop (lg+): the sidebar is rendered inline and can be collapsed to an
 *   icon rail. It auto-collapses when entering the inbox (the dense 4-column
 *   view benefits from the room) and restores the manual preference on the way
 *   out. The manual toggle still works while on a route; persisted in
 *   localStorage.
 * - Compact (< lg): the sidebar moves off-canvas into a left drawer (Sheet),
 *   opened by a hamburger in a thin top bar. The bar is hidden on the thread
 *   detail route (`/inbox/<id>`), which already has its own header + back
 *   button — avoiding a redundant double header on the chat view.
 *
 * Data (user/units/badges) is still fetched in the server layout and passed
 * down; this component only owns presentation state.
 */
export function AppShell({
  user,
  waitingCount,
  isAdmin,
  children,
}: {
  user: SidebarUser | null
  waitingCount: number
  isAdmin: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isInbox = pathname.startsWith('/inbox')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Auto-collapse on entering the inbox; restore the manual preference on exit.
  // Keyed on `isInbox` (not the full pathname), so navigating between the list
  // and a thread — both /inbox/* — does NOT re-fire, leaving a manual expand
  // intact while the operator stays in the inbox.
  const prevInboxRef = useRef<boolean | null>(null)
  useEffect(() => {
    const pref = () => localStorage.getItem(COLLAPSE_KEY) === '1'
    const was = prevInboxRef.current
    if (was === null) {
      // First mount: inbox starts collapsed; elsewhere honor the saved pref.
      setCollapsed(isInbox || pref())
    } else if (isInbox && !was) {
      setCollapsed(true) // entered the inbox
    } else if (!isInbox && was) {
      setCollapsed(pref()) // left the inbox → restore manual preference
    }
    prevInboxRef.current = isInbox
  }, [isInbox])

  function toggleCollapse() {
    setCollapsed((v) => {
      const next = !v
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      return next
    })
  }

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  // Thread detail (`/inbox/<id>`) has its own header; don't stack a second bar.
  const isThreadView = /^\/inbox\/[^/]+/.test(pathname)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop sidebar — inline, collapsible */}
      <div
        className={cn(
          'hidden shrink-0 lg:block',
          collapsed ? 'w-[68px]' : 'w-[220px]',
        )}
      >
        <Sidebar
          user={user}
          waitingCount={waitingCount}
          isAdmin={isAdmin}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />
      </div>

      {/* Compact sidebar — off-canvas drawer */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[78%] max-w-[260px] gap-0 p-0"
        >
          <Sidebar
            user={user}
            waitingCount={waitingCount}
            isAdmin={isAdmin}
            onNavigate={() => setMobileNavOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <main className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        {!isThreadView && (
          <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-card/80 px-3 backdrop-blur-sm lg:hidden">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Abrir menu"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Menu className="size-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bee.gif"
              alt=""
              aria-hidden
              className="size-4 shrink-0 object-contain"
            />
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
              7Bee.AI · Chat-CDT
            </span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          <PushSetup />
          {children}
        </div>
      </main>
    </div>
  )
}
