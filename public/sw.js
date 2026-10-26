// Service worker: keeps the learner app working with no connection.
// Bump VERSION whenever the app files change, so phones pick up the new version.
const VERSION = 'pm-v1';
const SHELL = ['/', '/index.html', '/js/check.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // API calls always go to the network; the app saves what it needs in IndexedDB.
  if (url.pathname.startsWith('/api/')) return;
  // Teacher and admin pages are online-only.
  if (url.pathname.startsWith('/teacher') || url.pathname.startsWith('/admin')) return;

  if (req.mode === 'navigate') {
    // Network first so updates arrive, falling back to the saved copy offline.
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/', copy)); return res; })
        .catch(() => caches.match('/'))
    );
    return;
  }
  // Static files: serve the saved copy at once, refresh it in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
