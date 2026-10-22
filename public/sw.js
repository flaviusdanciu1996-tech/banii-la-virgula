// Network-only service worker: makes the app installable and shows the daily reminder. Never caches app code.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})

self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data && e.data.text() } }
  e.waitUntil(self.registration.showNotification(d.title || 'Banii la virgulă', {
    body: d.body || 'Ai trecut cheltuielile de azi?',
    icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || 'daily-reminder', data: { url: d.url || './' },
    // Urgent (radar signal): stays on screen until touched, rings and vibrates long on every repeat.
    ...(d.urgent ? { requireInteraction: true, renotify: true, silent: false, vibrate: [800, 300, 800, 300, 800, 300, 1500] } : {}),
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus()
    return self.clients.openWindow(url)
  }))
})
