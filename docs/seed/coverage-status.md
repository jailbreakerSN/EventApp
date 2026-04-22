# Seed Data Coverage Status

<!--
  Auto-generated — DO NOT EDIT BY HAND.
  Regenerate with: npm run seed:status
  Sources:         apps/api/src/config/firebase.ts (COLLECTIONS)
                   scripts/seed/config.ts          (RESETTABLE_COLLECTIONS)
                   scripts/seed*.ts                (writer scan)
-->

- **Generated at:** 2026-04-22T07:47:47.648Z
- **Branch:**       `claude/email-audit-gaps-DLJuE`
- **Commit:**       `3b396fdc4767df623f701fb413e02f6585299192`

## Summary

- Total collections in `COLLECTIONS`: **41**
- With at least one seed writer: **25**
- In `RESETTABLE_COLLECTIONS` but no writer (reset-only): **8**
- Waived (runtime-only / operator-only): **11**
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
| `alerts` | **(not in COLLECTIONS)** | yes | — | yes |
| `auditLogs` | `AUDIT_LOGS` | yes | `scripts/seed/06-social.ts` | — |
| `badges` | `BADGES` | yes | `scripts/seed/05-activity.ts` | — |
| `badgeTemplates` | `BADGE_TEMPLATES` | yes | — | — |
| `balanceTransactions` | `BALANCE_TRANSACTIONS` | yes | — | — |
| `broadcasts` | `BROADCASTS` | yes | `scripts/seed/06-social.ts` | — |
| `checkinFeed` | `CHECKIN_FEED` | yes | `scripts/seed/06-social.ts` | yes |
| `checkinLocks` | `CHECKIN_LOCKS` | yes | — | yes |
| `checkins` | `CHECKINS` | yes | — | — |
| `conversations` | `CONVERSATIONS` | yes | `scripts/seed/06-social.ts` | — |
| `counters` | `COUNTERS` | yes | `scripts/seed/05-activity.ts` | — |
| `emailLog` | `EMAIL_LOG` | yes | — | yes |
| `emailSuppressions` | `EMAIL_SUPPRESSIONS` | yes | — | yes |
| `events` | `EVENTS` | yes | `scripts/seed/04-events.ts` | — |
| `feedComments` | `FEED_COMMENTS` | yes | `scripts/seed/06-social.ts` | — |
| `feedPosts` | `FEED_POSTS` | yes | `scripts/seed/06-social.ts` | — |
| `invites` | `INVITES` | yes | — | — |
| `messages` | `MESSAGES` | yes | `scripts/seed/06-social.ts` | — |
| `newsletterSubscribers` | `NEWSLETTER_SUBSCRIBERS` | yes | — | — |
| `notificationDispatchLog` | `NOTIFICATION_DISPATCH_LOG` | yes | — | yes |
| `notificationPreferences` | `NOTIFICATION_PREFERENCES` | yes | `scripts/seed/06-social.ts` | — |
| `notifications` | `NOTIFICATIONS` | yes | `scripts/seed/06-social.ts` | — |
| `notificationSettings` | `NOTIFICATION_SETTINGS` | yes | `scripts/seed/06-social.ts` | — |
| `notificationSettingsHistory` | `NOTIFICATION_SETTINGS_HISTORY` | yes | — | yes |
| `offlineSync` | `OFFLINE_SYNC` | yes | — | yes |
| `organizations` | `ORGANIZATIONS` | yes | `scripts/seed-emulators.ts`<br>`scripts/seed/01-organizations.ts` | — |
| `payments` | `PAYMENTS` | yes | `scripts/seed/05-activity.ts` | — |
| `payouts` | `PAYOUTS` | yes | — | — |
| `plans` | `PLANS` | **no** | `scripts/seed-plans.ts` | yes |
| `promoCodes` | `PROMO_CODES` | yes | — | — |
| `receipts` | `RECEIPTS` | yes | `scripts/seed/05-activity.ts` | — |
| `refundLocks` | `REFUND_LOCKS` | yes | — | yes |
| `registrations` | `REGISTRATIONS` | yes | `scripts/seed/05-activity.ts` | — |
| `sessionBookmarks` | `SESSION_BOOKMARKS` | yes | — | — |
| `sessions` | `SESSIONS` | yes | `scripts/seed/05-activity.ts` | — |
| `smsLog` | `SMS_LOG` | yes | — | yes |
| `speakers` | `SPEAKERS` | yes | `scripts/seed/05-activity.ts` | — |
| `sponsorLeads` | `SPONSOR_LEADS` | yes | `scripts/seed/05-activity.ts` | — |
| `sponsors` | `SPONSORS` | yes | `scripts/seed/05-activity.ts` | — |
| `subscriptions` | `SUBSCRIPTIONS` | yes | `scripts/seed/06-social.ts` | — |
| `users` | `USERS` | yes | `scripts/seed-qa-fixtures.ts`<br>`scripts/seed/02-users.ts` | — |
| `venues` | `VENUES` | yes | `scripts/seed/03-venues.ts` | — |

## Waivers

The following collections are intentionally excluded from the seed-coverage requirement. Each needs a one-line rationale in `SEED_COVERAGE_WAIVER` (`scripts/lib/seed-coverage-scan.ts`).

- `alerts` — Cloud Monitoring bounce-rate alert docs mirrored into Firestore by the scheduled Cloud Function. Runtime-only.
- `checkinFeed` — Already seeded today in 06-social.ts, but waived here so the collection can be demoted back to runtime-only without breaking CI if the QA fixture is ever removed.
- `checkinLocks` — Uniqueness-enforcement locks written transactionally by the scan path. Never seeded directly.
- `emailLog` — Runtime email dispatch log. Append-only; no seed fixtures.
- `emailSuppressions` — Resend webhook bounce/complaint output. Populated by the resendWebhook Cloud Function; seed data would contaminate the suppression list.
- `notificationDispatchLog` — Append-only runtime audit of notification deliveries. Populated by the dispatcher; no seed fixtures needed.
- `notificationSettingsHistory` — Append-only edit history for notificationSettings. Populated by the admin PUT flow; seed data would be synthetic noise.
- `offlineSync` — Transient per-device sync state written by the mobile client at runtime. No canonical seed shape — exercising it requires a real device round-trip.
- `plans` — System plan catalog (free/starter/pro/enterprise) — seeded idempotently by seed-plans.ts and intentionally preserved across resets so orgs never point at a missing plan mid-reset.
- `refundLocks` — In-flight refund serialisation locks — created and released inside the refund transaction. Never seeded directly.
- `smsLog` — Runtime SMS dispatch log. Append-only; no seed fixtures.

## CI integrity violations

No coverage gaps detected — every collection in `COLLECTIONS` is either in `RESETTABLE_COLLECTIONS` or waived.
