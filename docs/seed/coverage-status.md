# Seed Data Coverage Status

<!--
  Auto-generated — DO NOT EDIT BY HAND.
  Regenerate with: npm run seed:status
  Sources:         apps/api/src/config/firebase.ts (COLLECTIONS)
                   scripts/seed/config.ts          (RESETTABLE_COLLECTIONS)
                   scripts/seed*.ts                (writer scan)
-->

- **Generated at:** 2026-04-25T17:32:32.047Z
- **Branch:**       `claude/docs-seed-overhaul`
- **Commit:**       `82efbb119966bb8c155864e4f4b78874b534f601`

## Summary

- Total collections in `COLLECTIONS`: **53**
- With at least one seed writer: **41**
- In `RESETTABLE_COLLECTIONS` but no writer (reset-only): **0**
- Waived (runtime-only / operator-only): **18**
- CI integrity violations: **0**

## Truth table

Columns:
- **Collection** — Firestore collection name.
- **Const key** — Matching entry in `COLLECTIONS` (`apps/api/src/config/firebase.ts`).
- **In reset list?** — Wiped by `npm run seed:reset`.
- **Seed writer(s)** — Script(s) that write example data for this collection.
- **Waived?** — Listed in `SEED_COVERAGE_WAIVER` (`scripts/lib/seed-coverage-scan.ts`).

| Collection | Const key | In reset list? | Seed writer(s) | Waived? |
| --- | --- | --- | --- | --- |
| `adminJobLocks` | `ADMIN_JOB_LOCKS` | **no** | — | yes |
| `adminJobRuns` | `ADMIN_JOB_RUNS` | yes | `scripts/seed/08-admin-fixtures.ts` | — |
| `alerts` | **(not in COLLECTIONS)** | yes | — | yes |
| `announcements` | `ANNOUNCEMENTS` | yes | `scripts/seed/08-admin-fixtures.ts` | — |
| `apiKeys` | `API_KEYS` | **no** | — | yes |
| `auditLogs` | `AUDIT_LOGS` | yes | `scripts/seed/06-social.ts` | — |
| `badges` | `BADGES` | yes | `scripts/seed/05-activity.ts` | — |
| `badgeTemplates` | `BADGE_TEMPLATES` | yes | `scripts/seed/05-activity.ts` | — |
| `balanceTransactions` | `BALANCE_TRANSACTIONS` | yes | `scripts/seed/05-activity.ts` | — |
| `broadcasts` | `BROADCASTS` | yes | `scripts/seed/06-social.ts` | — |
| `checkinFeed` | `CHECKIN_FEED` | yes | `scripts/seed/06-social.ts` | yes |
| `checkinLocks` | `CHECKIN_LOCKS` | yes | — | yes |
| `checkins` | `CHECKINS` | yes | `scripts/seed/05-activity.ts` | — |
| `conversations` | `CONVERSATIONS` | yes | `scripts/seed/06-social.ts` | — |
| `counters` | `COUNTERS` | yes | `scripts/seed/05-activity.ts` | — |
| `couponRedemptions` | `COUPON_REDEMPTIONS` | yes | `scripts/seed/08-admin-fixtures.ts` | — |
| `emailLog` | `EMAIL_LOG` | yes | — | yes |
| `emailSuppressions` | `EMAIL_SUPPRESSIONS` | yes | `scripts/seed/06-social.ts` | yes |
| `events` | `EVENTS` | yes | `scripts/seed/04-events.ts` | — |
| `featureFlags` | `FEATURE_FLAGS` | yes | `scripts/seed/08-admin-fixtures.ts` | — |
| `feedComments` | `FEED_COMMENTS` | yes | `scripts/seed/06-social.ts` | — |
| `feedPosts` | `FEED_POSTS` | yes | `scripts/seed/06-social.ts` | — |
| `firestoreUsage` | `FIRESTORE_USAGE` | **no** | — | yes |
| `impersonationCodes` | `IMPERSONATION_CODES` | **no** | — | yes |
| `invites` | `INVITES` | yes | `scripts/seed/07-invites.ts` | — |
| `messages` | `MESSAGES` | yes | `scripts/seed/06-social.ts` | — |
| `newsletterSubscribers` | `NEWSLETTER_SUBSCRIBERS` | yes | `scripts/seed/06-social.ts` | — |
| `notificationDispatchLog` | `NOTIFICATION_DISPATCH_LOG` | yes | `scripts/seed/06-social.ts` | yes |
| `notificationPreferences` | `NOTIFICATION_PREFERENCES` | yes | `scripts/seed/06-social.ts` | — |
| `notifications` | `NOTIFICATIONS` | yes | `scripts/seed/06-social.ts` | — |
| `notificationSettings` | `NOTIFICATION_SETTINGS` | yes | `scripts/seed/06-social.ts` | — |
| `notificationSettingsHistory` | `NOTIFICATION_SETTINGS_HISTORY` | yes | `scripts/seed/06-social.ts` | yes |
| `offlineSync` | `OFFLINE_SYNC` | yes | — | yes |
| `organizations` | `ORGANIZATIONS` | yes | `scripts/seed-emulators.ts`<br>`scripts/seed/01-organizations.ts` | — |
| `payments` | `PAYMENTS` | yes | `scripts/seed/05-activity.ts` | — |
| `payouts` | `PAYOUTS` | yes | `scripts/seed/05-activity.ts` | — |
| `planCoupons` | `PLAN_COUPONS` | yes | `scripts/seed/08-admin-fixtures.ts` | — |
| `plans` | `PLANS` | **no** | `scripts/seed-plans.ts` | yes |
| `promoCodes` | `PROMO_CODES` | yes | `scripts/seed/05-activity.ts` | — |
| `rateLimitBuckets` | `RATE_LIMIT_BUCKETS` | **no** | — | yes |
| `receipts` | `RECEIPTS` | yes | `scripts/seed/05-activity.ts` | — |
| `refundLocks` | `REFUND_LOCKS` | yes | — | yes |
| `registrations` | `REGISTRATIONS` | yes | `scripts/seed/05-activity.ts` | — |
| `scheduledAdminOps` | `SCHEDULED_ADMIN_OPS` | **no** | — | yes |
| `sessionBookmarks` | `SESSION_BOOKMARKS` | yes | `scripts/seed/05-activity.ts` | — |
| `sessions` | `SESSIONS` | yes | `scripts/seed/05-activity.ts` | — |
| `smsLog` | `SMS_LOG` | yes | — | yes |
| `speakers` | `SPEAKERS` | yes | `scripts/seed/05-activity.ts` | — |
| `sponsorLeads` | `SPONSOR_LEADS` | yes | `scripts/seed/05-activity.ts` | — |
| `sponsors` | `SPONSORS` | yes | `scripts/seed/05-activity.ts` | — |
| `subscriptions` | `SUBSCRIPTIONS` | yes | `scripts/seed/06-social.ts` | — |
| `users` | `USERS` | yes | `scripts/seed-qa-fixtures.ts`<br>`scripts/seed/02-users.ts` | — |
| `venues` | `VENUES` | yes | `scripts/seed/03-venues.ts` | — |
| `webhookEvents` | `WEBHOOK_EVENTS` | **no** | — | yes |

## Waivers

The following collections are intentionally excluded from the seed-coverage requirement. Each needs a one-line rationale in `SEED_COVERAGE_WAIVER` (`scripts/lib/seed-coverage-scan.ts`).

- `adminJobLocks` — Single-flight locks for the admin job runner (T2.2). One doc per jobKey, held only while a handler is running (≤ 5 min) and deleted on completion. Transient operational state — seeding would either block the first real trigger or fill the collection with zombie locks. Reset behaviour is implicit (any run deletes its own lock; stale locks self-reclaim).
- `alerts` — Cloud Monitoring bounce-rate alert docs mirrored into Firestore by the scheduled Cloud Function. Runtime-only.
- `apiKeys` — T2.3 — organization-scoped API keys. Stored as SHA-256 hashes only; plaintext returned exactly once at issuance and never persisted. Seeding would write hashes whose plaintexts nobody holds, producing 'valid-looking but unusable' rows forever — confusing for QA and pointless for integration tests (which mint keys through the service API anyway).
- `checkinFeed` — Already seeded today in 06-social.ts, but waived here so the collection can be demoted back to runtime-only without breaking CI if the QA fixture is ever removed.
- `checkinLocks` — Uniqueness-enforcement locks written transactionally by the scan path. Never seeded directly.
- `emailLog` — Runtime email dispatch log. Append-only; no seed fixtures.
- `emailSuppressions` — Resend webhook bounce/complaint output. Populated by the resendWebhook Cloud Function; seed data would contaminate the suppression list.
- `firestoreUsage` — Sprint-4 T3.3 — per-org per-day Firestore read counters flushed by the AsyncLocalStorage middleware. Pure runtime telemetry. Seeding would either inflate the cost dashboard with synthetic numbers (misleading operators) or zero on every reset (defeating the rolling-window view). Append/increment-only; rules deny all client writes (Admin SDK only).
- `impersonationCodes` — Transient auth-code flow for super-admin impersonation — 60 s TTL, server-only writes via ImpersonationCodeService. Seed fixtures would be stale within a minute and have no QA value; security properties are exercised via integration tests, not seed data.
- `notificationDispatchLog` — Append-only runtime audit of notification deliveries. Populated by the dispatcher; no seed fixtures needed.
- `notificationSettingsHistory` — Append-only edit history for notificationSettings. Populated by the admin PUT flow; seed data would be synthetic noise.
- `offlineSync` — Transient per-device sync state written by the mobile client at runtime. No canonical seed shape — exercising it requires a real device round-trip.
- `plans` — System plan catalog (free/starter/pro/enterprise) — seeded idempotently by seed-plans.ts and intentionally preserved across resets so orgs never point at a missing plan mid-reset.
- `rateLimitBuckets` — Runtime-written rate-limit buckets — transient; populated by rateLimit() only when endpoints fire.
- `refundLocks` — In-flight refund serialisation locks — created and released inside the refund transaction. Never seeded directly.
- `scheduledAdminOps` — Sprint-4 T3.2 — operator-defined cron schedules that bind a registered admin job key, JSON input, cron expression, and timezone. Created exclusively from the back-office (super-admin) and dispatched out-of-process by a Cloud Functions scheduled trigger. Seeding synthetic rows would either fire bogus jobs against the dev environment on every emulator restart or sit perpetually paused — both confusing for QA. Rules deny all client writes (Admin SDK only).
- `smsLog` — Runtime SMS dispatch log. Append-only; no seed fixtures.
- `webhookEvents` — Runtime-received payment-provider webhooks (T2.1). Populated only when a provider actually calls /v1/payments/webhook/:provider. Seeding synthetic rows would either look like real deliveries in the admin console (misleading operators) or trigger replay attempts against non-existent payments (noise in the audit trail). Purely operational log.

## CI integrity violations

No coverage gaps detected — every collection in `COLLECTIONS` is either in `RESETTABLE_COLLECTIONS` or waived.
