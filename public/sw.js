/* =============================================================================
 * PrepSetu service worker — static app shell + offline fallback ONLY.
 * -----------------------------------------------------------------------------
 * Deliberately NEVER caches API responses: exam questions, answer sessions,
 * results, progress and profile data are private and must not be stored in a
 * shared HTTP cache (or be served stale to another user on a shared device).
 * The app handles offline exam resilience in memory + IndexedDB (see
 * src/lib/offlineQueue.ts), which is per-user and cleared on sign-out.
 * ============================================================================= */

const VERSION = 'prepsetu-v4';
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
// The asset layer redirects `/offline.html` → `/offline` (auto-trailing-slash
// HTML handling). Precache the canonical URL so `cache.addAll` never stores a
// redirected response, which would reject the whole install step.
const OFFLINE_URL = '/offline';

const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:css|js|woff2?|ttf|png|jpg|jpeg|svg|webp|webmanifest)$/i.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin (YouTube, Firebase, Google)

  // Never cache or intercept API traffic — private, dynamic and exam-critical.
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;

  // Navigation requests: network-first, fall back to the cached shell, then offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/index.html', response.clone()).catch(() => {});
          return response;
        } catch {
          const cachedShell = await caches.match('/index.html');
          if (cachedShell) return cachedShell;
          const offline = await caches.match(OFFLINE_URL);
          return offline || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
        }
      })(),
    );
    return;
  }

  // Static, hashed assets: cache-first with background revalidation.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) {
          event.waitUntil(
            fetch(request)
              .then((response) => {
                if (response.ok) caches.open(STATIC_CACHE).then((cache) => cache.put(request, response));
              })
              .catch(() => {}),
          );
          return cached;
        }
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        } catch {
          return new Response('', { status: 504 });
        }
      })(),
    );
  }
});

// Allow the page to trigger an immediate update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
