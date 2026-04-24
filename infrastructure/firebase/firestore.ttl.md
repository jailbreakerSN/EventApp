# Firestore TTL Policies

Firestore supports native field-based TTL (time-to-live) that automatically
deletes documents once a designated timestamp field is in the past. TTL is
provisioned via `gcloud` (or the GCP console) — it cannot be declared in
`firestore.rules` or `firestore.indexes.json`. Runs async with ~24 h worst-
case deletion latency per Firestore docs.

This file is the operator runbook for every TTL policy the platform relies
on. When adding a new one, append a section here and commit alongside the
code that starts writing the TTL field.

---

## `notificationDispatchLog.expiresAt` (Phase 2.5)

**What it does.** Auto-expires `notificationDispatchLog` rows once
`expiresAt` is in the past. Keeps the collection bounded without a
scheduled cleanup job.

**Retention policy (enforced in code at append time):**

| Row kind                        | Retention | Rationale                                                        |
| ------------------------------- | --------- | ---------------------------------------------------------------- |
| Normal send / suppression / dup | 90 days   | Matches the admin dashboard "last 90 days" aggregate window.     |
| Bounced / complained            | 365 days  | Keep a full year of deliverability evidence for CASL / CAN-SPAM. |

The field is populated by `NotificationDispatchLogRepository.append()` —
see `apps/api/src/repositories/notification-dispatch-log.repository.ts`
(helper `computeDispatchLogExpiry`).

### Provisioning

Run once per environment (staging + production):

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=notificationDispatchLog \
  --enable-ttl \
  --project=<FIREBASE_PROJECT_ID>
```

Verify:

```bash
gcloud firestore fields ttls list --project=<FIREBASE_PROJECT_ID>
```

Look for a row keyed `notificationDispatchLog.expiresAt` with
`ttlConfig.state: ACTIVE`.

### Monitoring

Deletion volume is visible in Cloud Monitoring under the metric
`firestore.googleapis.com/document/ttl_deletion_count`. Set up a soft
alert if the daily deletion rate stays at zero for more than 2 days
(indicates the TTL policy has been accidentally disabled or the write
path stopped populating `expiresAt`).

### Caveats

- TTL deletion is **eventual** (up to ~24 h). Queries that need a strict
  horizon MUST filter on `attemptedAt >= cutoff` rather than trusting
  that expired rows are gone.
- TTL deletions count as Firestore writes on the document's billable
  storage bucket. With ~1k rows/day at steady state this is a rounding
  error, but keep it in mind if volume grows.
- Disabling and re-enabling the TTL policy is a free operation but it
  takes ~5 minutes to propagate. No manual cleanup is needed during the
  switch.

---

## `rateLimitBuckets.expiresAt` (Phase D.4)

**What it does.** Auto-expires `rateLimitBuckets` rows once `expiresAt` is
in the past. The `rateLimit()` helper writes one doc per
`(scope, hashedIdentifier, windowStartBucket)` triple; without TTL the
collection grows monotonically with every distinct caller × endpoint ×
window. TTL keeps it bounded without a scheduled cleanup job.

**Retention policy (enforced in code at write time).** `expiresAt =
windowStartAt + 2 × windowSec`. The 2× headroom gives operators a window
to inspect a hot bucket after it rolls over (e.g. a `test-send:self`
abuse investigation) before Firestore's async sweep takes the doc. For
the `test-send:self` scope (windowSec=3600), that's 2 hours post-
rollover — well under the ~24 h TTL sweep latency.

The field is populated by `rateLimit()` —
see `apps/api/src/services/rate-limit.service.ts`.

### Provisioning

Run once per environment (staging + production). The
`notification-ops-prereqs` workflow already handles this for both
`notificationDispatchLog` and `rateLimitBuckets` in a single loop; the
raw gcloud command is:

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=rateLimitBuckets \
  --enable-ttl \
  --project=<FIREBASE_PROJECT_ID>
```

Verify:

```bash
gcloud firestore fields ttls list --project=<FIREBASE_PROJECT_ID>
```

Look for a row keyed `rateLimitBuckets.expiresAt` with
`ttlConfig.state: ACTIVE`.

### Monitoring

Same metric as notificationDispatchLog —
`firestore.googleapis.com/document/ttl_deletion_count` in Cloud
Monitoring. If the limiter is in active use the daily deletion rate
should trend positive; a week of zeros means either the TTL policy
lapsed or the limiter stopped being called (both worth investigating).

### Caveats

- **Fail-open collection**: `rateLimit()` fails open on Firestore
  errors. If TTL ever gets disabled, the collection grows without bound
  but the rate-limit logic itself keeps working — the only cost is
  Firestore storage. Monitor for it via the metric above.
- Doc ids are deterministic (`${scope}:${hashedId}:${windowStartBucket}`),
  so duplicate writers across pods converge on the same doc rather than
  creating parallel entries. TTL fires once the last writer has rolled
  off.
- Server-only collection: never exposed to clients (see
  `firestore.rules` → `match /rateLimitBuckets/{bucketId}`).

---

## `impersonationCodes.expiresAt` (Auth-code impersonation)

**What it does.** Auto-expires `impersonationCodes` rows 60 s after issue
(`issuedAt + 60_000 ms`). Every unconsumed row holds admin audit
metadata (actor uid, target uid, IPs, UAs) that should NOT linger once
its short-lived window is over; TTL makes the cleanup automatic.

**Retention policy.** Fixed 60-second TTL enforced in code at write time
(`ImpersonationCodeService.issue()` sets `expiresAt = new Date(now +
60_000)`). Consumed codes ALSO expire on the same deadline — the single-
use guarantee comes from the `consumedAt` field, not from the doc
disappearing. TTL is purely a storage hygiene concern.

The field is populated by `ImpersonationCodeService.issue()` —
see `apps/api/src/services/impersonation-code.service.ts`.

### Provisioning

Run once per environment (staging + production):

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=impersonationCodes \
  --enable-ttl \
  --project=<FIREBASE_PROJECT_ID>
```

Verify:

```bash
gcloud firestore fields ttls list --project=<FIREBASE_PROJECT_ID>
```

Look for a row keyed `impersonationCodes.expiresAt` with
`ttlConfig.state: ACTIVE`.

### Monitoring

Same metric — `firestore.googleapis.com/document/ttl_deletion_count`
in Cloud Monitoring. Expected daily rate matches admin impersonation
volume (≤ 20/hour/admin × number of super-admins). If deletion falls
to zero but issuances continue, TTL policy has lapsed; fall back to
a scheduled cleanup or alert on `impersonationCodes` size.

### Caveats

- **Single-use is enforced by `consumedAt`, not TTL.** A malicious
  replay hits the CONFLICT (409) branch regardless of TTL state. TTL
  only bounds storage.
- **Field naming.** The service writes `expiresAt` as a native JS
  `Date` (Admin SDK Timestamp) AND `expiresAtIso` as a string for audit
  readability. TTL evaluates `expiresAt` — keep the Date there.
- **Server-only collection**: never exposed to clients (see
  `firestore.rules` → `match /impersonationCodes/{codeHash}`).

---

## `webhookEvents.expiresAt` (T2.1 — webhook replay log)

**What it does.** Auto-expires `webhookEvents` rows 90 days after the
provider first delivered the webhook. Persists long enough for a real
ops replay workflow (Wave / Orange Money incidents are usually debugged
within days, rarely weeks) but bounded so the log never becomes
unbounded storage cost.

**Retention policy.** Fixed 90-day TTL enforced in code at receipt time
(`WebhookEventsService.record()` sets `expiresAt = firstReceivedAt +
90 days`). Replay attempts do NOT extend the TTL — once a webhook is
90 days old, its retention clock does not reset, even if an admin
replays it. This keeps retention predictable for audit + storage
forecasting.

The field is populated by `WebhookEventsService.record()` — see
`apps/api/src/services/webhook-events.service.ts`.

### Provisioning

Run once per environment (staging + production):

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=webhookEvents \
  --enable-ttl \
  --project=<FIREBASE_PROJECT_ID>
```

Verify:

```bash
gcloud firestore fields ttls list --project=<FIREBASE_PROJECT_ID>
```

Look for a row keyed `webhookEvents.expiresAt` with
`ttlConfig.state: ACTIVE`.

### Monitoring

Same metric — `firestore.googleapis.com/document/ttl_deletion_count`
in Cloud Monitoring. Expected daily deletion rate roughly matches the
webhook volume from 90 days prior. Sustained zero means either the TTL
policy lapsed or no webhook traffic has landed in the last 90 days
(both worth investigating in different directions).

### Caveats

- **Payment compliance is NOT served by this log.** Payment records
  (`payments` collection) carry their own retention (indefinite today,
  multi-year per WAEMU rules) — the webhook log is strictly for
  operational replay / debugging.
- **Raw body can hit 64 KB.** Bounded via truncation in the service
  (see comment on `record()`), so a rogue provider sending a 10 MB
  body never explodes a Firestore doc.
- **Server-only collection**: never exposed to clients (see
  `firestore.rules` → `match /webhookEvents/{eventId}`).
