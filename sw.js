const CACHE_NAME = 'tcg-vault-v37';
const IMAGE_CACHE = 'tcgvault-images-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './google-config.js',
  './manifest.json',
  './onepiece_cards.js',
  './gundam_cards.js',
  './icon-192.png',
  './icon-512.png'
];

// Hosts that serve card artwork. Images from these hosts are ONLY cached when
// the app explicitly asks (via cache.add from app.js, when a card is added to
// a deck or the trade binder) — never the whole library, per user request.
const IMAGE_HOSTS = ['optcgapi.com', 'gundam-gcg.com', 'images.scrydex.com', 'static.gundamcardlist.com', 'cardgamesearcher.com'];

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
  const isLocalGundamImage = url.origin === self.location.origin &&
    url.pathname.includes('/gundam-images/');

  const isCardImage = IMAGE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
  if (isCardImage || isLocalGundamImage) {
    // Network-first prevents stale/rate-limited/404 image responses from
    // getting stuck forever while still falling back to explicitly cached art.
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) =>
        fetch(event.request).then((resp) => {
          if (resp && resp.ok) cache.put(event.request, resp.clone());
          return resp;
        }).catch(() => cache.match(event.request))
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // let anything else hit the network directly

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        if (!resp || !resp.ok) return resp;
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return resp;
      }).catch(() => cached);
    })
  );
});
