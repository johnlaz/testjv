/**
 * jVox AAC v5 — Service Worker
 * Cache-first strategy for offline support.
 * Bump CACHE_NAME when deploying new releases to force clients to refresh.
 */

const CACHE_NAME = 'jvox-v5';
const SW_VERSION = '5.0.0';

const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon-48.png',
  './icon-72.png',
  './icon-96.png',
  './icon-128.png',
  './icon-192.png',
  './icon-256.png',
  './icon-384.png',
  './icon-512.png',
  './screenshot-splash.jpg',
  './screenshot-categories.jpg',
  './screenshot-wordbuilder.jpg',
  './screenshot-aura.jpg',
  './screenshot-regulate.jpg',
  './screenshot-wide.jpg',
  './sw.js',
];

// ── Dev/local bypass check ────────────────────────────────────────────────────
function isDevRequest(url) {
  return (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '0.0.0.0' ||
    url.hostname.startsWith('192.168.') ||
    url.hostname.startsWith('10.') ||
    url.protocol === 'chrome-extension:' ||
    (url.protocol !== 'https:' && url.protocol !== 'http:')
  );
}

// Allow the app to trigger immediate activation (e.g. "Update available" prompt)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log(`[jVox SW] v${SW_VERSION} activating, cache: ${CACHE_NAME}`);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first, network fallback ─────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Pass through dev/local requests — never cache
  if (isDevRequest(url)) return;

  // Pass through external API calls — never cache
  if (
    url.hostname === 'api.groq.com' ||
    url.hostname === 'nominatim.openstreetmap.org'
  ) return;

  // Network-first + cache for Google Fonts (GET only)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const net = fetch(event.request).then(r => {
            if (r.ok && event.request.method === 'GET') {
              cache.put(event.request, r.clone());
            }
            return r;
          });
          return cached || net;
        })
      )
    );
    return;
  }

  // Cache-first for everything else (app shell, icons, screenshots)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (
          !response ||
          response.status !== 200 ||
          event.request.method !== 'GET'
        ) return response;
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      }).catch(() => {
        // Navigate requests fall back to app shell; subresources get a clean 404
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 404 });
      });
    })
  );
});
