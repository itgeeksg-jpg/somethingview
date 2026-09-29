// Network-first service worker: every load revalidates with the server, so devices never get
// stuck on an old cached version; the cached copy is only used when offline.
const CACHE = 'somethingview-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok && !url.pathname.endsWith('version.json')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(url.href.split('#')[0], copy));
      }
      return res;
    } catch (err) {
      const hit = await caches.match(url.href.split('#')[0]) || (req.mode === 'navigate' && await caches.match(new URL('./', self.location).href));
      if (hit) return hit;
      throw err;
    }
  })());
});
