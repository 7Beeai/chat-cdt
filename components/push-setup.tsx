'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Phase = 'init' | 'unsupported' | 'prompt' | 'granted' | 'denied'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

async function subscribeAndPersist(registration: ServiceWorkerRegistration) {
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapid) {
    console.warn('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set; skipping subscribe')
    return
  }

  const existing = await registration.pushManager.getSubscription()
  if (existing) return

  let sub: PushSubscription
  try {
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // PushSubscriptionOptionsInit.applicationServerKey is typed as
      // BufferSource which (with @types/node 20+) excludes Uint8Array<SharedArrayBuffer>.
      // The runtime accepts Uint8Array regardless; cast to satisfy TS.
      applicationServerKey: urlBase64ToUint8Array(vapid) as unknown as BufferSource,
    })
  } catch (err) {
    console.warn('[push] subscribe failed', err)
    return
  }

  const json = sub.toJSON() as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    console.warn('[push] subscription missing fields')
    return
  }

  try {
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent:
          typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
    })
    if (!res.ok) {
      console.warn('[push] /api/push/subscribe responded', res.status)
    }
  } catch (err) {
    console.warn('[push] POST /api/push/subscribe failed', err)
  }
}

export function PushSetup() {
  const [phase, setPhase] = useState<Phase>('init')
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setPhase('unsupported')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js')
        if (cancelled) return
        setRegistration(reg)

        const perm = Notification.permission
        if (perm === 'granted') {
          setPhase('granted')
          await subscribeAndPersist(reg)
        } else if (perm === 'denied') {
          setPhase('denied')
        } else {
          setPhase('prompt')
        }
      } catch (err) {
        console.warn('[push] sw register failed', err)
        if (!cancelled) setPhase('unsupported')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const onEnable = useCallback(async () => {
    if (!registration || busy) return
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm === 'granted') {
        setPhase('granted')
        await subscribeAndPersist(registration)
      } else if (perm === 'denied') {
        setPhase('denied')
      }
    } catch (err) {
      console.warn('[push] requestPermission failed', err)
    } finally {
      setBusy(false)
    }
  }, [registration, busy])

  if (phase !== 'prompt') return null

  return (
    <div className="flex items-center gap-3 border-b border-border bg-card/60 px-6 py-3">
      <Bell className="size-4 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs uppercase tracking-wider text-accent">
          Notificações
        </p>
        <p className="text-sm text-foreground">
          Ativar avisos de novos atendimentos no navegador.
        </p>
      </div>
      <Button size="sm" onClick={onEnable} disabled={busy}>
        {busy ? 'Ativando…' : 'Ativar'}
      </Button>
    </div>
  )
}

export default PushSetup
