// Cache-first app shell plus the daily reminder. Everything here is static, so
// a plain cache-first strategy is correct; bump VERSION whenever any cached
// file changes and the new service worker will drop the old cache on activate.
const VERSION = 'v7';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'config.js',
  'dates.js',
  'db.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'manifest.webmanifest',
];

importScripts('dates.js', 'db.js');

self.addEventListener('install', (e) => {
  // cache:'reload' bypasses the browser's own HTTP cache. Without it a plain
  // addAll re-reads whatever is still fresh there -- GitHub Pages serves these
  // files with max-age -- and fills the brand new cache with the PREVIOUS
  // release's bytes, so bumping VERSION changes nothing that anyone can see.
  const fresh = ASSETS.map((url) => new Request(url, { cache: 'reload' }));
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Look only in this version's cache: while an update installs, the old and
  // new caches both exist and a plain caches.match() could mix their files.
  e.respondWith(
    caches.open(VERSION).then((c) => c.match(e.request)).then((hit) => hit || fetch(e.request))
  );
});

// The worker only knows dates, so its message is a rough count. The phone
// knows exactly what is in the fridge, so prefer the text built from here.
self.addEventListener('push', (e) => {
  let fallback = null;
  try { fallback = e.data?.json().summary ?? null; } catch {}
  e.waitUntil(
    DB.all()
      .then((items) => Dates.summary(items.map((i) => i.expires)))
      .catch(() => null)
      .then((line) =>
        self.registration.showNotification('Check your fridge', {
          // Browsers insist every push shows something, even if the fridge
          // was emptied since the last sync.
          body: line || fallback || 'Have a look at your leftovers.',
          icon: 'icon-192.png',
          badge: 'icon-192.png',
          tag: 'daily',
        })
      )
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => 'focus' in w);
      return win ? win.focus() : self.clients.openWindow('./');
    })
  );
});
