const CACHE_NAME = "teranga-v1";
const BADGES_CACHE_NAME = "teranga-badges-v1";
const OFFLINE_URL = "/offline";

// Pre-cache the offline fallback page on install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener("activate", (event) => {
  const KEEP_CACHES = [CACHE_NAME, BADGES_CACHE_NAME];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !KEEP_CACHES.includes(key))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Handle messages from the app (e.g. proactive badge caching)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CACHE_BADGE") {
    const url = event.data.url;
    if (!url) return;
    event.waitUntil(
      fetch(url)
        .then((response) => {
          if (response.ok) {
            return caches.open(BADGES_CACHE_NAME).then((cache) => cache.put(url, response));
          }
        })
        .catch(() => {
          // Network unavailable — nothing to cache
        })
    );
  }
});

// Check if a request URL matches a badge API route
function isBadgeRequest(url) {
  const path = url.pathname;
  // Matches: /v1/badges/me/{eventId}, /v1/badges/{badgeId}/download
  if (/^\/v1\/badges\//.test(path)) return true;
  // Matches: /v1/events/{id}/badges/{id}
  if (/^\/v1\/events\/[^/]+\/badges\//.test(path)) return true;
  // Matches: /v1/registrations/{id}/badge
  if (/^\/v1\/registrations\/[^/]+\/badge$/.test(path)) return true;
  return false;
}

// Fetch handler
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first, fallback to cached offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached || new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // Static assets (JS, CSS, images, fonts): cache-first with network fallback
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
          fetch(request).then((response) => {
            // Only cache successful responses
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // Badge API requests: network-first, fall back to badges cache
  if (isBadgeRequest(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(BADGES_CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request, { cacheName: BADGES_CACHE_NAME }).then(
            (cached) => cached || new Response(JSON.stringify({ success: false, error: { code: "OFFLINE", message: "Badge indisponible hors connexion" } }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            })
          )
        )
    );
    return;
  }

  // API requests and everything else: network-only
});
