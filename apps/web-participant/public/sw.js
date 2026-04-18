// Teranga participant app — service worker.
//
// Cache names are locale-tagged so a Wolof user offline sees the Wolof
// `/offline` page, not the French one that happened to land in cache
// first. The active locale is passed in via the SET_LOCALE message on
// boot and refreshed on LOCALE_CHANGED.

const CACHE_VERSION = "v2";
const DEFAULT_LOCALE = "fr";
const SUPPORTED_LOCALES = ["fr", "en", "wo"];

let activeLocale = DEFAULT_LOCALE;

const staticCache = (locale) => `teranga-${CACHE_VERSION}-static-${locale}`;
const badgesCache = (locale) => `teranga-${CACHE_VERSION}-badges-${locale}`;
const OFFLINE_URL = "/offline";

const liveCacheNames = () => {
  const names = [];
  for (const loc of SUPPORTED_LOCALES) {
    names.push(staticCache(loc), badgesCache(loc));
  }
  return names;
};

// Pre-cache the offline fallback page for every supported locale so we
// can serve the right one based on the user's NEXT_LOCALE cookie.
self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all(
      SUPPORTED_LOCALES.map((loc) =>
        caches.open(staticCache(loc)).then((cache) =>
          cache.add(OFFLINE_URL).catch(() => {
            // Best-effort; a single locale miss shouldn't block SW install.
          }),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

// Activate: drop caches that belong to older CACHE_VERSION values.
self.addEventListener("activate", (event) => {
  const keep = new Set(liveCacheNames());
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

// Messages from the app: badge pre-cache + locale updates.
self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SET_LOCALE" || event.data.type === "LOCALE_CHANGED") {
    const next = event.data.locale;
    if (typeof next === "string" && SUPPORTED_LOCALES.includes(next)) {
      activeLocale = next;
    }
    return;
  }

  if (event.data.type === "CACHE_BADGE") {
    const url = event.data.url;
    if (!url) return;
    event.waitUntil(
      fetch(url)
        .then((response) => {
          if (response.ok) {
            return caches
              .open(badgesCache(activeLocale))
              .then((cache) => cache.put(url, response));
          }
        })
        .catch(() => {
          // Network unavailable — nothing to cache.
        }),
    );
  }
});

// Check if a request URL matches a badge API route.
function isBadgeRequest(url) {
  const path = url.pathname;
  if (/^\/v1\/badges\//.test(path)) return true;
  if (/^\/v1\/events\/[^/]+\/badges\//.test(path)) return true;
  if (/^\/v1\/registrations\/[^/]+\/badge$/.test(path)) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests; cross-origin stays on the default.
  if (url.origin !== self.location.origin) return;

  // Navigation — network-first, fallback to the locale-matching offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(OFFLINE_URL, { cacheName: staticCache(activeLocale) })
          .then(
            (cached) =>
              cached ||
              caches.match(OFFLINE_URL, { cacheName: staticCache(DEFAULT_LOCALE) }),
          )
          .then((cached) => cached || new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }

  // Static assets: cache-first with network fallback.
  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "image" ||
    request.destination === "font"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request)
            .then((response) => {
              if (response.ok) {
                const clone = response.clone();
                caches
                  .open(staticCache(activeLocale))
                  .then((cache) => cache.put(request, clone));
              }
              return response;
            })
            .catch(() => new Response(null, { status: 408 })),
      ),
    );
    return;
  }

  // Badge API — network-first, fall back to the locale-tagged badges cache.
  if (isBadgeRequest(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches
              .open(badgesCache(activeLocale))
              .then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request, { cacheName: badgesCache(activeLocale) })
            .then(
              (cached) =>
                cached ||
                new Response(
                  JSON.stringify({
                    success: false,
                    error: { code: "OFFLINE", message: "Badge indisponible hors connexion" },
                  }),
                  { status: 503, headers: { "Content-Type": "application/json" } },
                ),
            ),
        ),
    );
    return;
  }

  // Everything else (API calls, etc.): network-only with an explicit timeout
  // response on failure so the client can distinguish "offline" from
  // "server down" instead of silently seeing the browser's generic error.
  event.respondWith(fetch(request).catch(() => new Response(null, { status: 408 })));
});
