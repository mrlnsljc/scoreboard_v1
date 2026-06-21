/* =============================================================================
   sw.js — service worker: app-shell precache + layered runtime caching so the
   app opens and shows last-fetched data even with no connection.

   Strategy:
   • App shell (html/css/js/icons): precached on install, served cache-first
     (stale-while-revalidate) so the UI always boots instantly + offline.
   • ESPN / TheSportsDB JSON: network-first, fall back to runtime cache. (The app
     ALSO caches JSON in localStorage; this is a second safety net.)
   • Team logos / badges (images): cache-first runtime cache.

   Bump CACHE_VERSION to force clients onto new assets.
   ============================================================================= */

const CACHE_VERSION = 'v3';
const SHELL_CACHE = `sb-shell-${CACHE_VERSION}`;
const API_CACHE = `sb-api-${CACHE_VERSION}`;
const IMG_CACHE = `sb-img-${CACHE_VERSION}`;

// App-shell assets (relative so it works from any subpath).
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/util/dom.js',
  './js/util/dates.js',
  './js/data/http.js',
  './js/data/espn.js',
  './js/data/teams.js',
  './js/data/golf.js',
  './js/data/standings.js',
  './js/data/thesportsdb.js',
  './js/data/logos.js',
  './js/store/store.js',
  './js/store/settings.js',
  './js/store/favorites.js',
  './js/ui/skeleton.js',
  './js/ui/render.js',
  './js/ui/views.js',
  './js/ui/search.js',
  './js/ui/golf.js',
  './js/ui/standings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll is atomic; ignore individual failures so install can't be blocked
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => ![SHELL_CACHE, API_CACHE, IMG_CACHE].includes(k)).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

const isESPN = (u) => u.hostname.endsWith('espn.com') && u.pathname.includes('/apis/');
const isTSDB = (u) => u.hostname.includes('thesportsdb.com');
const isImage = (u) => /\.(png|jpg|jpeg|svg|webp|gif)$/i.test(u.pathname) || u.hostname.includes('espncdn.com') || u.hostname.includes('thesportsdb.com') && /images/.test(u.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ---- navigations: serve the app shell ----
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // ---- API JSON: network-first, cache fallback ----
  if (isESPN(url) || (isTSDB(url) && url.pathname.includes('/api/'))) {
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }

  // ---- images (logos/badges): cache-first ----
  if (isImage(url)) {
    event.respondWith(cacheFirst(req, IMG_CACHE));
    return;
  }

  // ---- same-origin app shell: stale-while-revalidate ----
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  // default: try network, fall back to any cache
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    // cache opaque + ok responses so logos persist offline
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}
