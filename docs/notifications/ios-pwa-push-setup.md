# iOS PWA Web Push Setup (Phase D.5)

Operator runbook for enabling Apple Web Push delivery through the Teranga
iOS PWA. **Every step here is manual** — Apple's infrastructure is walled
off from automation: no Admin SDK, no first-party API for Developer
Program credentials, no programmatic upload of APNs keys.

> **Context**: Phase C.2 (PR #150) shipped the in-browser Web Push hook +
> service worker. Phase D.5 ships the PWA manifest, an "Add to Home Screen"
> nudge, and a post-install push prompt so iOS 16.4+ users can actually
> receive pushes. iOS Safari **only** delivers Web Push inside an installed
> PWA, and that PWA must sit behind an APNs-configured Firebase project.

---

## TL;DR

1. Keep an active **Apple Developer Program** membership.
2. Generate an **APNs Authentication Key** on the Apple Developer portal.
3. Upload the `.p8` file + Key ID + Team ID into the Firebase Console
   (Cloud Messaging → Apple app configuration).
4. Install the Teranga PWA on an iOS 16.4+ device and verify push delivery.

The same APNs key serves the PWA today and the native Wave 9 iOS app
later — one upload per Firebase project covers both surfaces.

---

## Why none of this is automatable

- **Apple Developer Program membership** requires Apple ID sign-in, legal
  acceptance, and an annual payment. No SCIM / no programmatic sign-up.
- **APNs key creation** is gated behind a human-operator captcha on
  developer.apple.com. The resulting `.p8` is shown **once**; there is no
  API to retrieve it later.
- **Firebase APNs config** is uploaded via the Firebase Console UI. The
  Admin SDK has a `messaging()` method for **sending**, but no surface
  for managing APNs credentials — and the REST API
  (`firebase.googleapis.com/v1*`) does not expose an `iosAppConfig.apns`
  resource.

Outcome: one operator, once per Firebase project, per key rotation
(recommended annually).

---

## Step 1 — Apple Developer Program

Prerequisite for everything below.

1. Sign in to https://developer.apple.com with the team's shared Apple ID.
2. Confirm the program enrollment is active (status card on the member
   center home page).
3. Note the **Team ID** — shown in the upper-right of the member center
   (a 10-character alphanumeric string).

If the membership has lapsed, APNs rejects new subscriptions silently —
existing subscriptions also drift into "unregistered" within hours. Renew
first, then continue.

---

## Step 2 — Generate an APNs Authentication Key

Token-based auth is strongly preferred over certificate-based auth:

- No yearly expiry (versus APNs SSL certs which expire every 12 months).
- One key covers both development and production APNs environments.
- One key can be shared across multiple apps in the same team.

Procedure:

1. Developer portal → **Certificates, Identifiers & Profiles** → **Keys**.
2. Click the **+** icon to register a new key.
3. Name: `Teranga APNs Key (YYYY)` — tag the year so rotations stay
   obvious.
4. Tick **Apple Push Notifications service (APNs)** under Services.
5. Click **Continue** → **Register** → **Download**.
6. Store the downloaded `.p8` file in the team's password manager under
   `secrets/apple/apns/teranga-YYYY.p8`. **Apple will not let you
   re-download it.**
7. Note the **Key ID** — also shown on the download page (10-character
   string).

---

## Step 3 — Upload to Firebase Console

One upload per Firebase project. Repeat for staging + production if they
are separate projects (`teranga-app-990a8` and `teranga-events-prod`).

1. Open the [Firebase Console](https://console.firebase.google.com) and
   select the target project.
2. Project settings (gear icon) → **Cloud Messaging** tab.
3. Scroll to **Apple app configuration**.
   - If no iOS app is registered yet, click **Add app** → **iOS+** and
     fill in the bundle ID (`sn.teranga.events` for production). The PWA
     does **not** need a separate iOS app entry — Web Push delivery uses
     the APNs key at project level, not the per-app APNs cert.
4. Under **APNs Authentication Key**, click **Upload**.
5. Select the `.p8` file from Step 2.
6. Enter the **Key ID** and **Team ID** (from Steps 1 and 2).
7. Click **Upload**.

After a few seconds the Firebase Console displays "Authentication key
uploaded" and the FCM-to-APNs bridge is live. No code redeploy required
on our side — the server uses `firebase-admin.messaging()` which picks
up the new key automatically.

---

## Step 4 — Verify on a real iOS device

Simulators cannot receive Web Push — Apple routes APNs traffic only to
real devices.

1. On an iPhone / iPad running iOS 16.4 or later, open Safari.
2. Visit the participant site (staging: https://participant.staging.teranga.sn).
3. Engage with the site enough that the `useAddToHomeScreen` banner
   surfaces (≥3 visits + not dismissed). Manually: open the site 3 times
   or pre-seed `localStorage.setItem("teranga.visits", "10")` in the
   Safari console.
4. Tap **Installer** on the banner, follow the 3 Safari steps
   (Share → Scroll → Add to Home Screen).
5. Launch the installed "Teranga" icon from the home screen. The `?source=pwa`
   query param + `matchMedia(display-mode: standalone)` trigger
   `useIsPwa()` to report `true`.
6. Within 5 seconds the post-install **PushPermissionBanner** surfaces
   (trigger: `"pwa-installed"`). Tap **Activer les notifications** and
   accept iOS's native permission dialog.
7. From the backoffice (or `scripts/seed-emulators.ts` test harness),
   fire a test notification to the participant.
8. Confirm the push lands on the device's lock screen.

---

## Key rotation

APNs keys don't expire, but Apple's guidance is to rotate yearly.

1. Generate a new key via Step 2 (year-stamped name).
2. Upload via Step 3 — the Firebase Console replaces the active key
   atomically; in-flight deliveries are unaffected.
3. Revoke the old key in the Apple Developer portal **only after** you've
   confirmed the new one works for at least one push round-trip in
   production.

---

## Out of scope for Phase D.5

- **iOS Badging API.** Setting a numeric badge on the home-screen icon
  requires a separate `notifications+badge` permission and a
  `navigator.setAppBadge()` call from the service worker. Safari
  currently gates this behind a Feature Flag. Revisit when Apple
  promotes it to default-on.
- **Native iOS app.** Wave 9 will build a Flutter iOS client that uses
  the same APNs key. No additional setup needed then — the key is
  already uploaded.
- **Web Push on macOS Safari (non-PWA).** Supported from Safari 16.1,
  does NOT require home-screen install, and Phase C.2's banner already
  covers it without any Phase D.5 changes.

---

## Troubleshooting

| Symptom                                            | Most likely cause                                            | Fix                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `getToken()` throws `messaging/permission-blocked` | User tapped "Don't Allow" once; iOS remembers forever        | User must uninstall + reinstall the PWA to get a new prompt |
| Push registers, but nothing arrives                | APNs key not uploaded / mismatched environment               | Re-check Step 3; confirm Key ID + Team ID                   |
| Banner never surfaces after install                | `teranga.push.banner.pwaInstalledShown` sticks across installs | Clear Safari site data for the domain                       |
| `Notification.permission === "unsupported"`        | User still in Safari tab, not the PWA                        | Confirm `useIsPwa()` returns true                           |

See `docs/notifications/web-push-setup.md` for the VAPID half of this
story and `docs/notifications/channels.md` for the broader notification
design.
