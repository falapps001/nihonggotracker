// Service worker: aplikasi tetap bisa dibuka tanpa internet.
const CACHE = 'nt-v1.0.2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'sync.js', 'firebase-config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Firestore & Auth selalu lewat jaringan (jangan di-cache)
  if (/googleapis\.com$/.test(url.hostname) && !/fonts\.googleapis\.com$/.test(url.hostname)) return;
  if (url.origin === location.origin) {
    // file aplikasi: pakai jaringan dulu supaya update cepat, cache kalau offline
    // cache: 'no-cache' melewati cache HTTP browser, jadi update langsung terambil saat online
    e.respondWith(fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  } else if (/gstatic\.com$|fonts\.googleapis\.com$/.test(url.hostname)) {
    // SDK Firebase & font: cache dulu
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});
