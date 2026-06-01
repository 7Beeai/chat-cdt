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

/**
 * Lays out the thread (flex) + the collapsible context panel. Owns the
 * `contextOpen` state so the thread header's "i" toggle can show/hide the
 * panel without a navigation. Defaults open on wide screens.
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
  // Open by default on desktop; closed on compact screens, where the panel is
  // an overlay that would otherwise cover the thread on load.
  const [contextOpen, setContextOpen] = useState(true)
  useIsoLayoutEffect(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) setContextOpen(false)
  }, [])

  return (
    <div className="flex min-h-0 w-full">
      <ThreadClient
        initial={initial}
        conversation={conversation}
        userId={userId}
        initialMediaUrls={initialMediaUrls}
        operatorNames={operatorNames}
        contextOpen={contextOpen}
        onToggleContext={() => setContextOpen((v) => !v)}
      />
      {contextOpen && (
        <>
          {/* Tap-to-close scrim — compact screens only (panel is an overlay) */}
          <div
            onClick={() => setContextOpen(false)}
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            aria-hidden
          />
          <ContextPanel
            conversation={conversation}
            debtor={debtor}
            onClose={() => setContextOpen(false)}
          />
        </>
      )}
    </div>
  )
}
