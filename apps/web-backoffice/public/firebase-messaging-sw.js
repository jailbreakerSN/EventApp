// Teranga backoffice — Firebase Messaging service worker (Phase C.2).
//
// Runs at the app origin scope. Next.js does NOT transform files in
// `public/`, so we use the Firebase compat CDN bundles (the only form
// that works inside a service worker — `importScripts` can't load ES
// modules) and read the Firebase config off the SW's registration
// query string. That keeps the SW file immutable at deploy time so
// browsers don't re-download it on every build, while still letting
// us swap the config between staging / prod envs without a build-step
// placeholder substitution.
//
// Version pin: 11.1.0 — matches `"firebase": "^11.1.0"` in
// apps/web-backoffice/package.json. Keeping CDN + npm in lockstep
// avoids the "main thread sends a token via getToken(), SW validates
// against an older schema" class of bug. When the npm dep bumps,
// update both SWs in this repo.
/* eslint-disable no-restricted-globals */
/* global importScripts, firebase, clients */

importScripts(
  "https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js",
);

// Read the Firebase config from the SW registration query string —
// navigator.serviceWorker.register('/firebase-messaging-sw.js?apiKey=…').
// Falls back to empty strings rather than throwing so the SW still
// installs; messaging.onBackgroundMessage simply won't have an app to
// route through if config is missing, which is the correct degraded
// behaviour (no crash loop).
const swUrl = new URL(self.location.href);
const params = swUrl.searchParams;

firebase.initializeApp({
  apiKey: params.get("apiKey") || "",
  authDomain: params.get("authDomain") || "",
  projectId: params.get("projectId") || "",
  storageBucket: params.get("storageBucket") || "",
  messagingSenderId: params.get("messagingSenderId") || "",
  appId: params.get("appId") || "",
});

const messaging = firebase.messaging();

// Optional API base — the SW posts back-annotations (push-displayed /
// push-clicked) here. Passed on the register query string too, defaults
// to same-origin for local dev.
const API_URL = params.get("apiUrl") || "";

// Fire-and-forget observability hook. The endpoints are optional — if the
// backend doesn't implement them yet the fetch simply errors and we swallow
// it; the SW must never fail a notification display over a missing probe.
async function pingBackAnnotation(notificationId, action) {
  if (!notificationId || !API_URL) return;
  try {
    await fetch(`${API_URL}/v1/notifications/${encodeURIComponent(notificationId)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // SW has no user auth token — the endpoint will treat this as an
      // anonymous probe and either accept it (observability stub) or
      // 401 (which we ignore — don't retry, don't log).
      keepalive: true,
    });
  } catch {
    // Swallow — don't let a network blip break the notification UX.
  }
}

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Teranga";
  const body = payload.notification?.body || "";
  const data = payload.data || {};

  // `tag` dedupes overlapping notifications (e.g. two badge-generated
  // pushes for the same registration collapse into one). Fall back to
  // notificationId when present, otherwise random so unrelated pushes
  // don't stomp each other.
  const tag = data.notificationId || data.key || `teranga-${Date.now()}`;

  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data,
    tag,
    requireInteraction: false,
  });

  if (data.notificationId) {
    // eslint-disable-next-line no-void
    void pingBackAnnotation(data.notificationId, "push-displayed");
  }
});

// Chrome on 2G sometimes delivers the raw `push` event without handing
// off to messaging.onBackgroundMessage (unparseable data payload). This
// fallback ensures the user still sees *something* — without it, the
// notification is silently dropped.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return; // onBackgroundMessage will handle structured payloads.
  }
  if (!payload?.notification && !payload?.data) return;

  const title = payload.notification?.title || "Teranga";
  const body = payload.notification?.body || "";
  const data = payload.data || {};
  const tag = data.notificationId || data.key || `teranga-${Date.now()}`;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data,
      tag,
      requireInteraction: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const deepLink = data.deepLink || data.url || "/";
  const notificationId = data.notificationId;

  event.waitUntil(
    (async () => {
      if (notificationId) {
        await pingBackAnnotation(notificationId, "push-clicked");
      }

      // Focus an existing tab on the deep-link URL if one is already open —
      // opening a duplicate would be annoying UX on desktop. Otherwise
      // open a new window.
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const target = new URL(deepLink, self.location.origin).href;
      for (const client of allClients) {
        if (client.url === target && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(target);
      }
      return undefined;
    })(),
  );
});
