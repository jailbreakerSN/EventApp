# Web Push Setup (Phase C — Firebase Cloud Messaging VAPID)

End-to-end operator runbook for the one manual step in the Web Push
lifecycle. Every other step is automated via
`.github/workflows/notification-ops-prereqs.yml` (provisioning) and
`.github/workflows/deploy-staging.yml` (build-time bake + deploy).

> **Context**: Phases B + C (PR #150) shipped the client-side Web Push
> hook + service workers. They read `NEXT_PUBLIC_FIREBASE_VAPID_KEY`
> from the client bundle. Without that env var the registration hook
> degrades to `permission: "unsupported"` at runtime and the push
> banner never renders — the apps still work, just without background
> push. See `docs/notifications/channels.md` for the full channel
> design.

---

## TL;DR

1. Firebase Console → **generate a VAPID key pair** (once per GCP project).
2. Add the public key as `FIREBASE_VAPID_KEY` on the matching GitHub Actions environment secret.
3. Run **Notification Ops Prerequisites** workflow → it mirrors the key into Secret Manager and binds it to Cloud Run.
4. Next `deploy-staging.yml` run bakes it into both web app bundles.
5. Users can now opt into Web Push.

No code changes required for any of the above after Phase C.

---

## Why step 1 can't be automated

Firebase Admin SDK does **not** expose VAPID key management. The
Firebase Console's "Generate key pair" button calls an internal,
IAM-gated endpoint that our deploy service account cannot reach:

- `firebase-admin.messaging()` only **sends** messages via existing
  project credentials.
- `firebase.googleapis.com/v1*` exposes project + web app config — no
  `webPushCertificates` resource.
- `fcmregistrations.googleapis.com` is the ingestion endpoint for
  **browser** subscriptions, not certificate management.

The VAPID keypair is also a security boundary: Firebase holds the
**private** half internally and never exposes it — only the public
half signs JS-side push subscriptions. Generating our own keypair
would fork us off FCM (self-hosted web-push), which we've explicitly
chosen not to do.

Outcome: one console click per project, once. The workflow handles
everything downstream.

---

## Step 1 — Firebase Console (manual, once per environment)

For **each** Firebase project that serves a Teranga environment
(typically staging + production):

1. Open the [Firebase Console](https://console.firebase.google.com)
   and select the project.
2. **Project settings** → **Cloud Messaging** tab.
3. Scroll to **Web Push certificates**.
4. Click **Generate key pair**.
5. Copy the resulting public key. It's an 87–88 character base64url
   string starting with the byte `B` (e.g.
   `BJx1aK0…-dLKVc4`).
6. **Do not** rotate key pairs you already generated in the past —
   existing browsers registered with the old key would lose push
   until they re-register. See [Rotation](#rotation) below.

---

## Step 2 — GitHub Actions secret

Set the `FIREBASE_VAPID_KEY` **environment** secret (not repository
secret — per-env, so staging and production can diverge):

1. Repo → **Settings** → **Environments**.
2. Select the target environment (`staging` or `production`).
3. **Add environment secret**: name `FIREBASE_VAPID_KEY`, value = the
   public key you copied in step 1.
4. Save.

> **Why environment-scoped**: the `NEXT_PUBLIC_FIREBASE_VAPID_KEY`
> baked into the client bundle must match the VAPID half registered
> for that environment's Firebase project. If staging and production
> share a secret, browser subscriptions made against one project are
> rejected by the other.

---

## Step 3 — Run the ops workflow

**Actions** → **Notification Ops Prerequisites** → **Run workflow**:

- `environment`: pick target (the workflow uses GitHub's environment
  protection, so production requires a reviewer if configured).
- `dry_run`: start with `true` to preview; re-run with `false` to
  apply.
- `skip_*`: leave all unchecked unless re-running a subset.

The new `web-push-vapid` job does three things (idempotent):

1. **Asserts** the secret is present; emits an actionable error
   pointing back here if not.
2. **Creates / updates** the `FIREBASE_VAPID_KEY` entry in Secret
   Manager (new version added only when the GitHub secret differs —
   prevents version churn on re-runs).
3. **Grants** the Cloud Run runtime SA + Cloud Functions runtime SA
   the `secretmanager.secretAccessor` role on the entry.
4. **Binds** the secret onto the API Cloud Run service via
   `--update-secrets`, so future server-side flows (e.g. admin test
   push via Admin SDK) pick up rotation without a redeploy.

No extra IAM setup is needed — the `ensure-iam` job granted the
`secretmanager.admin` + `run.admin` roles the first time it ran.

---

## Step 4 — Deploy

The next push to `develop` triggers `deploy-staging.yml`. Both the
backoffice and participant Docker builds now pass
`NEXT_PUBLIC_FIREBASE_VAPID_KEY=${{ secrets.FIREBASE_VAPID_KEY }}` as
a build-arg. Next.js inlines it into the client bundle at build time.

Verification after deploy:

```bash
curl -s https://participant.terangaevent.com/ \
  | grep -o 'NEXT_PUBLIC_FIREBASE_VAPID_KEY[^"]\{0,96\}' | head -1
```

You should see the key embedded in the Next.js runtime config.
(If you're worried about leaking it: don't — the public VAPID key
is literally designed to ship in every web-push implementation's
browser bundle.)

---

## Step 5 — User opt-in

Nothing to do — the banner + preferences page handle it.

The `useWebPushRegistration` hook (both apps) reads the key via
`process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY`, calls
`getToken(messaging, { vapidKey })`, and posts the resulting FCM token
to `POST /v1/me/fcm-tokens`.

---

## Rotation

Rotation is **rare** — only do it when:

- The key is believed compromised (shouldn't happen; only the public
  half ever leaves Firebase).
- Firebase explicitly rotates on our behalf (historically hasn't).

Procedure:

1. Firebase Console → Web Push certificates → **Add key pair**
   (don't delete the old one yet).
2. Copy the new public key.
3. Update the `FIREBASE_VAPID_KEY` GitHub env secret (replace the
   old value).
4. Re-run the ops workflow → adds a new Secret Manager version, Cloud
   Run picks up `:latest` on its next revision.
5. Trigger a staging deploy so the new value is baked into the
   client bundle.
6. Monitor the admin observability dashboard for `fcm.token_revoked`
   spikes — existing browsers will re-register on next visit.
7. After ~30 days of zero pushes signed by the old key, delete the
   old key in Firebase Console.

---

## Troubleshooting

**Workflow fails with "FIREBASE_VAPID_KEY environment secret is missing"**

You skipped step 2. Follow the instructions in the error message.

**Workflow succeeds but the banner doesn't render in prod**

The `NEXT_PUBLIC_*` env var is baked at **build time**, not deploy
time. If you set the secret after the last `deploy-staging.yml` run,
the current Docker image was built without the key. Re-run
`deploy-staging.yml` (manual dispatch or push a no-op commit).

**Banner renders but permission grant doesn't register an FCM token**

Check browser DevTools → Application → Service Workers → is
`firebase-messaging-sw.js` active? If it failed to register, check
the Network tab for the service worker request URL — it should carry
the Firebase config as query params (`?apiKey=…&projectId=…`). A
missing param would block FCM.

**iOS Safari < 16.4 users see the banner but clicking "Activate"
does nothing**

Expected. The hook surfaces `permission: "unsupported"` on those
browsers so the banner should actually be hidden. If it's visible,
check `Notification` and `navigator.serviceWorker` existence (either
missing → unsupported).

**Rotation: old browsers still show pushes after a key change**

That's correct — Firebase keeps old key pairs active for a grace
period. Existing subscriptions signed with the old VAPID key keep
working; only *new* subscriptions use the new key. Clean up the old
key in Firebase Console after the grace period if you're doing a
hard rotation for security.

---

## References

- [Firebase Cloud Messaging — Web Push certificates](https://firebase.google.com/docs/cloud-messaging/js/client#configure_web_credentials_with_fcm)
- [RFC 8292 — Voluntary Application Server Identification (VAPID) for Web Push](https://datatracker.ietf.org/doc/html/rfc8292)
- Local files:
  - `apps/web-*/src/hooks/use-web-push-registration.ts` — client hook.
  - `apps/web-*/public/firebase-messaging-sw.js` — service worker.
  - `.github/workflows/notification-ops-prereqs.yml` — provisioning.
  - `.github/workflows/deploy-staging.yml` — build-time bake.
