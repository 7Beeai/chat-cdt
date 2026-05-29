'use client'

import { useState } from 'react'

import type {
  ConversationView,
  DebtorContext,
  Message,
} from '@/app/(app)/inbox/[id]/page'
import { ThreadClient } from '@/app/(app)/inbox/[id]/thread-client'

import { ContextPanel } from './context-panel'

type MediaState = { url: string | null; pending: boolean }

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
  const [contextOpen, setContextOpen] = useState(true)

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
        <ContextPanel conversation={conversation} debtor={debtor} />
      )}
    </div>
  )
}
