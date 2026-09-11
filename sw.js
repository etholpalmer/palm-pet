// Offline-first shell cache. D1: no build step, so the list is written by hand.
// The event log lives in IndexedDB and is never cached here.

// Bump on every deploy. Cache-first with a fixed name never updates: an installed
// client keeps serving the shell it first saw, so a deploy silently reaches nobody.
const CACHE = 'palmpet-2026-09-11c';
const SHELL = [
  './', './index.html', './manifest.json', './icon.svg',
  './apple-touch-icon.png', './icon-192.png', './icon-512.png',
  './src/U1.js', './src/U2.js', './src/U4.js', './src/U5.js', './src/U7.js',
  './src/U9.js', './src/U10.js', './src/U11.js', './src/U12.js', './src/U13.js',
  './src/shell/app.js', './src/shell/db.js', './src/shell/geo.js', './src/shell/config.js',
  './src/shell/report.js',
];

// `cache: 'reload'` on every install request. Plain addAll goes through the browser's HTTP
// cache, so a worker installing shortly after a deploy can populate a brand-new cache with the
// PREVIOUS files and serve them under a fresh cache name — observed on 2026-09-08, where
// palmpet-2026-09-08d was created holding the old app.js. Bumping the cache name is not enough
// on its own; the fetches that fill it have to bypass the HTTP cache too.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Stale-while-revalidate. The cached copy is served immediately, so the capture loop
// still works with no network, every time; the background fetch means the next launch
// after a deploy has the new shell without waiting for a cache-name bump to reach here.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then((cache) => cache.match(e.request).then((hit) => {
    const fresh = fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') cache.put(e.request, res.clone());
        return res;
      })
      .catch(() => hit);        // offline: the cached copy is the answer, not an error
    return hit ?? fresh;
  })));
});
