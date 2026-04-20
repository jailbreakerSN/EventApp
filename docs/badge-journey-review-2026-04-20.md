# Badge Journey — End‑to‑End Security & UX Review

**Date:** 2026-04-20
**Scope:** Participant badge lifecycle — event subscription → badge issuance → scan → audit
**Status:** Review approved; implementation phased (see §4)

---

## 1. The journey today

1. **Register** — `POST /v1/registrations` wraps the whole thing in a transaction,
   assigns status (`confirmed` / `pending` / `waitlisted`), and signs a v3 QR on
   the server:
   `registrationId:eventId:userId:notBeforeBase36:notAfterBase36:HMAC-SHA256`
   (`apps/api/src/services/registration.service.ts:140`,
   `apps/api/src/services/qr-signing.ts:59`). v2/v1 QRs keep verifying; the
   scan path backfills the validity window from the event dates for them.
2. **Badge** — two paths today: on‑demand participant render
   (`badge.service.ts:313`, deterministic doc id `${eventId}_${userId}`),
   and organizer‑initiated Cloud Function rendering that uploads to Storage
   (`apps/functions/src/triggers/badge.triggers.ts`).
3. **Scan** — `POST /v1/registrations/checkin`: HMAC verified → registration re‑read
   inside `db.runTransaction` → status flipped to `checked_in` atomically
   (`registration.service.ts:407-488`). Double‑tap & concurrent scans are blocked
   by the transaction.
4. **Offline** — staff pre‑sync via `GET /v1/checkin/:eventId/sync` (≤20k regs,
   cursor‑paginated), then bulk reconcile with
   `POST /v1/checkin/:eventId/checkin/sync`; server transaction re‑checks status
   per item (`checkin.service.ts:193-267`).
5. **Audit** — every mutation emits a domain event; `audit.listener.ts` writes to
   `auditLogs` (Admin‑SDK only per rules).

The skeleton is strong: HMAC full digest, `timingSafeEqual`, deny‑all rules on
`badges`, transactional writes, per‑event ticket binding all verified. The gaps
are the classic **offline‑first vs anti‑fraud** tension.

## 2. Core tension

| Constraint                             | Implication                                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline‑first (Teranga differentiator) | Staff app must validate without network → QR must carry enough signal to decide offline → **we cannot rotate QRs every 15 s (Ticketmaster SafeTix model)**. |
| Anti‑screenshot                        | Static QRs can be shared → we need a **different** anti‑duplication vector than rotation.                                                                   |
| Senegalese market reality              | Staff devices have intermittent connectivity; NFC is rare; printed badges are common.                                                                       |

The reformulation picks a **middle ground**: static per‑registration QR
(keeps offline) + bounded validity window + device‑attested offline scans +
gate‑side deduplication with "first‑wins" reconciliation.

## 3. Findings & reformulation — by stage

Severity key: **P0** = security/fraud, **P1** = UX/integrity, **P2** = polish.

### 3.1 Registration & credential issuance

| #   | Finding                                                                                                                                                 | Recommendation                                                                                                                                                                                           | Sev |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 1.1 | `QR_SECRET` is a single global secret; no rotation story, no per‑event scoping. Compromise = all past & future badges forgeable. (`config/index.ts:32`) | Per‑event signing keys derived with HKDF: `eventKey = HKDF(QR_MASTER, salt=eventId)`. Only the master needs protecting; rotating an event key becomes a metadata field. Adds ~1 line to `qr-signing.ts`. | P0  |
| 1.2 | No key rotation or versioning.                                                                                                                          | Prefix the signature with a **key id**: `registrationId:eventId:userId:ts:kid:sig`. Verifier picks key by `kid`, allows overlapping old+new during rotation window.                                      | P1  |
| 1.3 | No "not‑before / not‑after" semantics — a QR is valid forever.                                                                                          | Embed `validFrom` and `validUntil` **inside the signed payload** (derive from `event.startDate − 24 h` to `event.endDate + 6 h`). Verifier enforces. Keeps offline scans working inside the window.      | P0  |
| 1.4 | `Registration.qrCodeValue` stored plaintext in Firestore → leaked backup = leaked QRs.                                                                  | Store only the **payload** (`regId:eventId:userId:ts:kid`) and recompute signature on demand. Costs 1 HMAC per read but removes the bearer‑token‑at‑rest problem.                                        | P2  |

### 3.2 Badge access

| #   | Finding                                                                                                                                                             | Recommendation                                                                                                                                                                       | Sev |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| 2.1 | Two badge paths coexist (`getMyBadge` deterministic id + `generate()` random id). Same (event, user) can end up with two docs.                                      | Collapse to **one writer**. Make `generate()` use `${eventId}_${userId}` id and transactional create — same pattern as `getMyBadge`. Cloud Function trigger stays for PDF rendering. | P1  |
| 2.2 | PDF stream has no per‑endpoint rate limit — flat global 100 req / 60 s per auth key. A stolen token could enumerate badges of other events this user registered to. | Tighter `@fastify/rate-limit` config on `GET /badges/me/*/pdf` (e.g. 10/min per user).                                                                                               | P1  |
| 2.3 | `handleSaveOffline` caches the PDF via SW — good. But the QR payload is the only thing strictly needed offline; the PDF is a luxury.                                | Document this on the page, ensure the QR payload is cached in **IndexedDB** even if the PDF fetch fails. (Already half‑done via `badge-store.ts`.)                                   | P2  |

### 3.3 Scan — the fraud gate

| #   | Finding                                                                                                                                                                       | Recommendation                                                                                                                                                                                                                                                                                                                                                     | Sev |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| 3.1 | `verifyQrPayload` parses `createdAt` but **never checks staleness** (`qr-signing.ts:55`). An old scan payload is forever valid.                                               | At scan time, reject if `now` outside `[validFrom − 2 h, validUntil + 2 h]` (windows from 1.3). Returns `QrExpiredError`.                                                                                                                                                                                                                                          | P0  |
| 3.2 | Offline cache returns QRs of all confirmed users. A screenshot‑shared QR scans successfully as long as the real owner hasn't synced yet.                                      | Combined defenses: (a) **device attestation** — staff app sends `scannerDeviceId` + `scannedAt` + `scannerNonce`; server records `checkedInBy.deviceId` and flags same‑QR‑different‑device within N minutes; (b) **photo capture at gate** — scanner app snaps low‑res face/ID photo into `checkins/{id}/proof`, reviewed only on dispute. Deterrent, not a block. | P0  |
| 3.3 | No per‑registration single‑scan constraint on the server beyond status flip. Nothing to build on for multi‑entry events.                                                      | Introduce a **`checkins` collection** keyed by `{registrationId, scanTimestamp}` with status (`success` / `duplicate` / `rejected`) and a composite unique constraint on `registrationId + firstScan`. `registration.status` becomes a denormalized cache of first successful entry. Unlocks per‑zone multi‑scan (access → lunch → afterparty).                    | P1  |
| 3.4 | `POST /checkin/sync` has no rate limiting per event or staff. Compromised staff token could replay 10k offline checkins.                                                      | Rate‑limit `/checkin/*` routes per `(staffUserId, eventId)` tuple. Cap bulk sync payload at 500 items / request.                                                                                                                                                                                                                                                   | P1  |
| 3.5 | "First‑wins" is correct but invisible to staff. Two staff scanning same badge 5 s apart — the second gets `already_checked_in` but no trace of **who** the first scanner was. | Duplicate response includes `{ checkedInAt, checkedInBy: { displayName, deviceId } }`. UX: red toast "Déjà validé par Aminata il y a 12 s".                                                                                                                                                                                                                        | P1  |
| 3.6 | Zone‑capacity check exists in `bulkSync` but not in live `registration.checkIn`.                                                                                              | Fold the `checkin.service.ts:231-246` zone guard into the live `checkIn` transaction.                                                                                                                                                                                                                                                                              | P2  |

### 3.4 Audit & reconciliation

| #   | Finding                                                                                                                                  | Recommendation                                                                                                                                                                                                        | Sev |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 4.1 | `checkin.completed` audit event has `source: "offline_sync"` but no device id.                                                           | Add `{ deviceId, scannerNonce, clientScannedAt, serverConfirmedAt }` to the audit payload. Enables post‑event forensics.                                                                                              | P1  |
| 4.2 | Offline sync download ships plaintext QRs for every confirmed participant. Leaked staff device = leaked credentials for the whole event. | (a) **Encrypt sync payload** with per‑staff‑session key derived at login; (b) **TTL the cache** — auto‑purge 24 h after event end; (c) **Audit the download** — log `checkin.offline_sync.downloaded` with device id. | P0  |
| 4.3 | No organizer dashboard showing "scanning anomalies".                                                                                     | Simple `/events/:id/security` backoffice page fed by `auditLogs` stream with 3 widgets: duplicates rejected, velocity outliers, device mismatches. Cheap, high signal.                                                | P2  |

## 4. Sequencing

**Sprint A — "Block the obvious fraud vectors" (P0, ~3–4 days)**

- 1.3 + 3.1 validity window + staleness check
- 4.2 encrypted offline sync + 24 h TTL
- 3.2a device attestation in offline scan payload

**Sprint B — "Harden the credential" (P0 / P1, ~3 days)**

- 1.1 per‑event HKDF key + 1.2 key id + rotation
- 2.1 collapse badge writers
- 3.5 duplicate response carries "scanned‑by"

**Sprint C — "Multi‑entry & forensics" (P1 / P2, ~1 week)**

- 3.3 dedicated `checkins` collection
- 3.6 zone enforcement on live scan
- 4.3 security widget

**Sprint D — "Polish" (P2)**

- 3.2b gate photo capture
- 1.4 don't‑store‑signature
- 2.3 offline PDF docs

## 5. Industry references

- **Ticketmaster SafeTix** — rotating 15 s QR. Rejected here (breaks offline). We borrow **device binding** instead.
- **IATA BCBP (airline boarding)** — static signed barcode + ID check at gate. Closest analog to our setup. They layer agent attestation + CCTV; we layer device attestation + optional photo.
- **Cvent / Bizzabo** — static QR + online‑only scan + kiosk hardware. Avoid offline; we can't.
- **Eventbrite** — static QR + "scanned already" soft warning, no signing. Weaker than what we already have.
- **Luma / Partiful** — static QR + magic links. Consumer‑grade; no fraud defense.

Teranga ends up in a distinct quadrant: **offline‑capable + cryptographically
signed + device‑attested** — the right fit for the West African event market
and an actual differentiator.

## 6. Implementation tracker

| Item                                           | Status                        | PR / commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.3 — validity window in payload               | shipped                       | `claude/fix-badge-pdf-generation-wAhdP` — v3 QR format                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3.1 — staleness check at scan                  | shipped                       | same commit — enforced in `registrationService.checkIn` + `checkinService.bulkSync`, with v1/v2 fallback derived from event dates                                                                                                                                                                                                                                                                                                                                                                                             |
| 3.2a — device attestation                      | shipped                       | same branch — `scannerDeviceId` + `scannerNonce` accepted on both live (`POST /registrations/checkin`) and bulk-sync paths; device id persisted on the registration, full attestation (nonce, `clientScannedAt`, server-confirmed time, `source`) rides the `checkin.completed` audit event; `scannedAt` sanity bounds from the prior pass retained (future > skew / past > 7 d → `invalid_qr`); fields optional on the wire so older mobile builds keep working                                                              |
| 3.5 — backoffice shows expired / not-yet-valid | shipped                       | same branch — dedicated toast + `ScanResultCard` for each code                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4.2 — encrypted offline sync + download audit  | server shipped; mobile queued | same branch — `GET /v1/checkin/:eventId/sync` opt-in ECDH-X25519 → HKDF-SHA256 → AES-256-GCM envelope (`?encrypted=v1&clientPublicKey=…`), plaintext kept as default for back-compat; `ttlAt` (`event.endDate + 24 h`) always returned so clients can schedule their purge without decrypting; every call — encrypted or not — emits `checkin.offline_sync.downloaded` with `{ staffId, scannerDeviceId, encrypted, itemCount, ttlAt }` into `auditLogs`. Flutter-side purge + encryption client still to ship — see §7 below |
| Sprint B+                                      | not started                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 7. Client follow-up — Flutter staff cache TTL purge (4.2b mobile side, queued)

Server now returns `ttlAt` in both sync paths. The staff device must
auto-purge the cached bundle after it to contain blast radius if the
device is lost. Design spec produced by the planning pass (grounded in
the current Flutter code layout):

- **Add** `apps/mobile/lib/features/scanner/data/offline_cache_repository.dart`
  to own read / write / purge on Hive box `offlineEvents` (opened at
  `apps/mobile/lib/main.dart:48`). Store each entry as
  `{ registrations, downloadedAt, ttlAt }` keyed by `eventId`.
- **Purge triggers** — both purely local Hive ops, no network needed:
  1. Startup sweep in `main.dart` right after the box opens, before
     `runApp`.
  2. `WidgetsBindingObserver` on the root `ConsumerWidget`
     (`apps/mobile/lib/app.dart:9`) that re-runs the sweep on
     `AppLifecycleState.resumed`.
  3. Read-path guard in `scanner_page.dart:54-64`: if `ttlAt <= now`,
     treat the entry as missing and show the existing
     "Synchronisez d'abord" state.
- **Clock-skew grace:** 6 h buffer on the comparison (`now > ttlAt + 6h`
  triggers purge) — avoids wiping mid-event on a fast-clock device.
  Flutter app also stashes the `Date` response header from the last
  online API call as `lastServerTimeSkewMs` in the `settings` box;
  subtract it from `now` before comparing.
- **What to wipe:** only the `offlineEvents` entry for the expired
  `eventId`, plus matching `pending` items in the `checkinQueue` box
  (filter by eventId — never blanket-clear). Auth, settings, and
  server-side audit logs untouched.
- **Encryption client** (paired with 4.2a above): Flutter generates an
  ephemeral X25519 keypair per sync, sends the public half as
  `?encrypted=v1&clientPublicKey=<b64url>`, derives the AES key via
  ECDH + HKDF-SHA256 (`info = "teranga/offline-sync/v1"`), unseals with
  AES-256-GCM using `eventId` as AAD. Private half never leaves memory.

Web backoffice check-in page (`apps/web-backoffice/.../checkin/page.tsx`)
is online-only (no service worker, no IndexedDB offline store) — no
purge work required there beyond the existing 10 s react-query refetch.

### Migration impact (v3 QR rollout)

- **New registrations after this deploy** are signed v3 with a window of
  `[event.startDate − 24 h, event.endDate + 6 h]` (+ 2 h clock-skew grace
  on both edges at scan time).
- **Existing v1/v2 registrations** keep verifying. At scan time we backfill
  the window from the event dates — same formula — so legacy badges also
  get the staleness shield.
- **Participants with confirmed registrations for PAST events** will now
  see `QR_EXPIRED` when trying to open or scan their badge. Intended
  behaviour, but customer support should be briefed on this new error
  path ("votre badge a expiré à la clôture de l'événement").
- No backfill job is needed — the fallback handles legacy QRs in place.
