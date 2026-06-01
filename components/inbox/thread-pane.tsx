'use client'

import { useEffect, useLayoutEffect, useState } from 'react'

import type {
  ConversationView,
  DebtorContext,
  Message,
} from '@/app/(app)/inbox/[id]/page'
import { ThreadClient } from '@/app/(app)/inbox/[id]/thread-client'

import { ContextPanel } from './context-panel'

type MediaState = { url: string | null; pending: boolean }

// useLayoutEffect on the client, useEffect on the server — avoids the SSR
// warning while still running before paint (so the panel never flashes open
// on compact screens).
const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

// Lembra a última escolha de abrir/fechar os detalhes entre contatos (desktop).
const CONTEXT_KEY = 'chat-cdt:context-open'

function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(min-width: 1024px)').matches
  )
}

/**
 * Lays out the thread (flex) + the collapsible context panel. Owns the
 * `contextOpen` state so the thread header's "i" toggle can show/hide the
 * panel without a navigation.
 *
 * Persistence: on desktop the open/closed choice is stored in localStorage and
 * restored on every contact switch (each navigation remounts this component),
 * so the panel keeps the operator's last decision instead of always reopening.
 * On compact screens it's an ephemeral right-side overlay → always starts
 * closed and never writes the desktop preference.
 */
export function ThreadPane({
  initial,
  conversation,
  userId,
  initialMediaUrls,
  debtor,
  operatorNames,
}: {
  initial: Message[]
  conversation: ConversationView
  userId: string
  initialMediaUrls: Record<string, MediaState>
  debtor: DebtorContext | null
  operatorNames: Record<string, string>
}) {
  // Default CLOSED (matches SSR); the layout effect restores the stored desktop
  // choice before paint. First access (no stored pref) stays closed. Mobile is
  // always closed (ephemeral overlay).
  const [contextOpen, setContextOpen] = useState(false)
  useIsoLayoutEffect(() => {
    if (!isDesktop()) return // already closed
    setContextOpen(localStorage.getItem(CONTEXT_KEY) === '1')
  }, [])

  // Set + persist the desktop preference (mobile overlay stays ephemeral).
  function applyContext(next: boolean) {
    setContextOpen(next)
    if (isDesktop()) localStorage.setItem(CONTEXT_KEY, next ? '1' : '0')
  }

  return (
    <div className="flex min-h-0 w-full">
      <ThreadClient
        initial={initial}
        conversation={conversation}
        userId={userId}
        initialMediaUrls={initialMediaUrls}
        operatorNames={operatorNames}
        contextOpen={contextOpen}
        onToggleContext={() => applyContext(!contextOpen)}
      />
      {contextOpen && (
        <>
          {/* Tap-to-close scrim — compact screens only (panel is an overlay) */}
          <div
            onClick={() => applyContext(false)}
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            aria-hidden
          />
          <ContextPanel
            conversation={conversation}
            debtor={debtor}
            onClose={() => applyContext(false)}
          />
        </>
      )}
    </div>
  )
}
