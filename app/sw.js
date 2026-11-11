import { Serwist, CacheFirst, ExpirationPlugin } from 'serwist';

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [{
    matcher: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/_next/static/'),
    handler: new CacheFirst({ cacheName: 'static-assets', plugins: [new ExpirationPlugin({ maxEntries: 150 })] }),
  }],
});
serwist.addEventListeners();

self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json() || {}; } catch { payload = {}; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Hati reminder', { body: payload.body || '', data: { url: payload.url || '/' } }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin);
    const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  })());
});
