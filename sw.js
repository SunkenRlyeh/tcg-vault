const CACHE_NAME = 'tcg-vault-v3';
const IMAGE_CACHE = 'tcgvault-images-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './onepiece_cards.js',
  './gundam_cards.js',
  './icon-192.png',
  './icon-512.png'
];

// Hosts that serve card artwork. Images from these hosts are ONLY cached when
// the app explicitly asks (via cache.add from app.js, when a card is added to
// a deck or the trade binder) — never the whole library, per user request.
const IMAGE_HOSTS = ['optcgapi.com', 'gundam-gcg.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // Clean up old app-shell cache versions, but never touch the image cache —
      // that one is managed explicitly by the user via the Collection tab.
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== IMAGE_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  const isCardImage = IMAGE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
  if (isCardImage) {
    // Cache-first for images that were explicitly saved (owned cards / deck cards).
    // Anything not explicitly cached just goes straight to the network and is
    // NOT auto-stored, keeping the offline image set small and intentional.
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => cached || fetch(event.request))
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // let anything else hit the network directly

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return resp;
      }).catch(() => cached);
    })
  );
});
