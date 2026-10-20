/* No cache of attendance records, locations, or private attachments. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload;

      try {
        payload = event.data?.json();
      } catch {
        return;
      }

      if (!payload || typeof payload.userId !== 'string') {
        return;
      }

      // A shared phone or logged-out browser must not display the previous account's push.
      let response = await fetch('/api/attendance/push-user', {
        credentials: 'include',
        cache: 'no-store',
      });

      if (response.status === 401) {
        const refresh = async () => {
          await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          });
        };

        if (self.navigator.locks) {
          await self.navigator.locks.request('admin-web:auth-refresh', refresh);
        } else {
          await refresh();
        }

        response = await fetch('/api/attendance/push-user', {
          credentials: 'include',
          cache: 'no-store',
        });
      }

      if (!response.ok) {
        return;
      }

      const current = await response.json();

      if (current.userId !== payload.userId) {
        return;
      }

      await self.registration.showNotification(
        payload.title || '아몬드영 워크',
        {
          body: payload.body || '아몬드영 워크에서 확인해 주세요.',
          tag: payload.tag,
          icon: '/pwa-attendance/icon-192.png?v=clock-2',
          data: { url: payload.url },
        }
      );
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const requested = event.notification.data?.url;
  const path =
    typeof requested === 'string' &&
    /^\/(attendance|company\/attendance)(\/[a-z-]+)?$/.test(requested)
      ? requested
      : '/attendance';
  const destination = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const current = windows.find((window) => window.url === destination);

      if (current) {
        await current.focus();
        return;
      }

      await self.clients.openWindow(destination);
    })()
  );
});
