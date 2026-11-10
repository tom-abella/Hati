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
