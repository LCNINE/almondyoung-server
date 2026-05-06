importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

const firebaseReady = self.fetch('/api/firebase-config')
  .then((r) => r.json())
  .then((config) => {
    if (!firebase.apps.length) firebase.initializeApp(config)
    const messaging = firebase.messaging()

    messaging.onBackgroundMessage((payload) => {
      const { title, body, icon } = payload.notification || {}
      self.registration.showNotification(title || '알림', {
        body,
        icon: icon || '/android-chrome-192x192.png',
        data: payload.data,
      })
    })

    return messaging
  })

self.addEventListener('install', (event) => {
  event.waitUntil(firebaseReady.then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const clickAction =
    event.notification.data?.FCM_MSG?.notification?.click_action ||
    event.notification.data?.clickAction ||
    '/'
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url === clickAction && 'focus' in client) return client.focus()
        }
        return clients.openWindow(clickAction)
      })
  )
})
