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
