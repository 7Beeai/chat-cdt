import webpush from 'web-push'

export type PushSubscription = {
  endpoint: string
  p256dh: string
  auth: string
}

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

let vapidConfigured = false

function ensureVapid() {
  if (vapidConfigured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      '[push] VAPID env missing: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required'
    )
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
}

export async function sendPush(
  sub: PushSubscription,
  payload: PushPayload
): Promise<void> {
  ensureVapid()
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload)
    )
  } catch (err: unknown) {
    // web-push throws WebPushError with `statusCode`. Preserve it.
    const e = err as { statusCode?: number; body?: unknown; message?: string }
    const wrapped = new Error(
      `[push] sendNotification failed${e.statusCode ? ' ' + e.statusCode : ''}: ${e.message ?? 'unknown'}`
    ) as Error & { statusCode?: number; body?: unknown }
    if (e.statusCode) wrapped.statusCode = e.statusCode
    if (e.body) wrapped.body = e.body
    throw wrapped
  }
}
