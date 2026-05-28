self.addEventListener('install', (e) => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch {}
  const title = data.title || 'CHAT-CDT'
  const opts = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/badge.png',
    tag: data.tag,
    data,
    requireInteraction: false,
  }
  event.waitUntil(self.registration.showNotification(title, opts))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/inbox'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes('/inbox'))
      if (existing) return existing.focus().then((c) => c.navigate(url)).catch(() => existing.focus())
      return self.clients.openWindow(url)
    })
  )
})
