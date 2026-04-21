# Notification System Roadmap

**Status:** `in-progress` — Phase 1 foundation landing on `claude/setup-resend-emails-nIwYV`
**Last updated:** 2026-04-21
**Owner:** Platform team

## Overview

Teranga currently ships 10 email notifications wired directly into services via
`emailService.sendXxx(...)` helpers. An audit (see
[`notification-audit-2026-04-21.md`](./notification-audit-2026-04-21.md))
identified ~18 additional notification gaps across security, revenue,
organization membership, and subscription lifecycles. The target architecture
(see [`notification-system-architecture.md`](./notification-system-architecture.md))
introduces a declarative **Notification Catalog**, a central **Dispatcher**,
per-user preference toggles, and a super-admin **Control Plane** so notifications
can be tuned without a code deploy.

This roadmap breaks the work into 6 phases. Phases 1-4 ship as **v1** and close
the functional gap. Phases 5-6 ship as **v2** and add observability plus the
multi-channel stack (SMS, push, in-app).

| Phase | Name                                         | Scope                                          | Release | Effort         |
| ----- | -------------------------------------------- | ---------------------------------------------- | ------- | -------------- |
| 1     | Foundation — Catalog + Dispatcher + Settings | Wire the plumbing; zero functional change      | v1      | M (3-4 days)   |
| 2     | Listener coverage — close P0/P1 gaps         | Add listeners for ~14 notifications            | v1      | L (1 week)     |
| 3     | User preferences — per-key toggles           | API + web UI on both apps                      | v1      | M (3-4 days)   |
| 4     | Super-admin Control Plane                    | `/admin/notifications` page + audit            | v1      | L (1 week)     |
| 5     | Observability & Analytics                    | Dispatch log, delivery stats, bounce dashboard | v2      | L (1 week)     |
| 6     | Multi-channel — SMS / push / in-app          | Adapters for the 3 other channels              | v2      | XL (2-3 weeks) |

---

## Phase 1 — Foundation (in-progress on `claude/setup-resend-emails-nIwYV`)

Introduce the catalog, dispatcher, settings repository, and audit plumbing
**without changing a single user-visible email**. All 10 existing helpers are
refactored into thin shims that call `dispatch()` under the hood. A feature flag
allows instant rollback if anything misbehaves.

Checklist:

- [ ] Add `NotificationChannel`, `NotificationCategory`, `NotificationDefinition`, `NotificationSetting`, `NotificationRecipient`, `DispatchRequest` types to `packages/shared-types/src/notification-catalog.ts`
- [ ] Seed catalog with the 10 currently-shipped notifications (registration.created, registration.approved, badge.ready, event.cancelled, event.reminder, payment.succeeded, newsletter.welcome, auth.email_verification, auth.password_reset, newsletter.confirm)
- [ ] Rebuild shared-types: `npm run types:build`
- [ ] Add `NOTIFICATION_SETTINGS = "notificationSettings"` to `COLLECTIONS` in `apps/api/src/config/firebase.ts`
- [ ] Create `apps/api/src/repositories/notification-settings.repository.ts` extending `BaseRepository<NotificationSetting>`
- [ ] Add Firestore rule: deny-all on `notificationSettings` and `notificationDispatchLog` in `infrastructure/firebase/firestore.rules`
- [ ] Create `apps/api/src/services/notification.service.ts` — `dispatch()` entry point (see architecture §7)
- [ ] Add audit actions to `packages/shared-types/src/audit.types.ts`: `notification.sent`, `notification.suppressed`, `notification.setting_updated`
- [ ] Extend `apps/api/src/events/listeners/audit.listener.ts` to translate the 3 new events into `auditLogs` rows
- [ ] Refactor 10 `emailService.sendXxx` helpers in `apps/api/src/services/email.service.ts:402-516` to shim `dispatch()`
- [ ] Feature flag: `NOTIFICATIONS_DISPATCHER_ENABLED` (default OFF in prod, ON in dev/staging)
- [ ] Tests: dispatcher happy path, admin-disabled short-circuit, user-opt-out path, security-notification ignores opt-out, idempotency dedup, audit events fire
- [ ] Run `@security-reviewer`, `@firestore-transaction-auditor`, `@domain-event-auditor`
- [ ] Open PR on `develop`

**Success criteria:** every existing email still sends identically, but
observability events + kill-switch are in place.

---

## Phase 2 — Listener coverage (v1)

Close the 14 notification gaps identified by the audit. Each item below
represents one full slice — template, catalog registration, listener, tests.
Group by priority: P0 = revenue/security-critical, P1 = must-fix-this-quarter.

**P0 (revenue/security):**

- [ ] `payment.failed` listener + react-email template `PaymentFailed.tsx`
- [ ] `subscription.past_due` — requires new scheduled-cron service + domain event + template `SubscriptionPastDue.tsx`
- [ ] `invite.sent` — listener on `invite.created`, template `InviteSent.tsx` (handles co_organizer / speaker / sponsor / staff variants)
- [ ] `registration.cancelled` — listener on `registration.cancelled`, 2 template variants (`RegistrationCancelledBySelf.tsx`, `RegistrationCancelledByOrganizer.tsx`)

**P1 (must-fix this quarter):**

- [ ] `event.rescheduled` — detect in `event.updated` listener (compare dates), template `EventRescheduled.tsx`
- [ ] `waitlist.promoted` — listener on `waitlist.promoted`, template `WaitlistPromoted.tsx`
- [ ] `welcome` — emit new `user.created` event in auth trigger, template `Welcome.tsx`
- [ ] `password.changed` — new `user.password_changed` event, template `PasswordChanged.tsx`
- [ ] `email.changed` — new `user.email_changed` event, template `EmailChanged.tsx` (sent to OLD address)
- [ ] `refund.issued` / `refund.failed` — listener on `payment.refunded`, templates `RefundIssued.tsx` / `RefundFailed.tsx`
- [ ] `member.added` / `member.removed` / `member.role_changed` — 3 listeners, templates reuse `MemberUpdate.tsx` with variant param
- [ ] `speaker.added` / `sponsor.added` — 2 listeners, templates `SpeakerAdded.tsx` / `SponsorAdded.tsx`
- [ ] `subscription.upgraded` / `downgraded` / `cancelled` — 3 listeners, templates reuse `SubscriptionChange.tsx`
- [ ] `payout.created` — listener on `payout.created`, template `PayoutCreated.tsx`

**Success criteria:** catalog grows from 10 to ~24 entries; all P0/P1 gaps in
the audit closed.

---

## Phase 3 — User preferences (v1)

Give users per-key opt-out control, while leaving security and transactional
notifications un-mutable (`userOptOutAllowed === false`).

Checklist:

- [ ] Extend `notificationPreferences` type in `packages/shared-types/src/user.types.ts` with `byKey: Record<string, boolean>`
- [ ] API: `GET /v1/users/me/notification-preferences` — returns catalog + current user toggles
- [ ] API: `PATCH /v1/users/me/notification-preferences` — body `{ byKey: Record<string, boolean> }`
- [ ] Web-participant: `/settings/notifications` page, grouped by category, with master marketing pause
- [ ] Web-backoffice: `/settings/notifications` page (same shape, different layout)
- [ ] Honour `userOptOutAllowed === false` (grey out + tooltip explaining why)
- [ ] French/English/Wolof translations for all copy
- [ ] Tests: route-level auth, schema validation, dispatcher honours the new toggles

**Success criteria:** users can opt out of marketing per-key; security /
transactional remain forced.

---

## Phase 4 — Super-admin Control Plane (v1)

Expose the `notificationSettings` collection through an admin-only UI so
platform operators can disable, reroute, or customize any notification without
a deploy.

Checklist:

- [ ] API: `GET /v1/admin/notifications` — returns catalog ⋈ settings (merged view), `requirePermission("platform:manage")`
- [ ] API: `PUT /v1/admin/notifications/:key` — upsert setting, emits `notification.setting_updated`
- [ ] Web-backoffice: `/admin/notifications` page in super-admin section
  - Table: key, category, enabled toggle, channel multi-select, subject override button
  - Inline edit (optimistic update + toast on success/failure)
  - Only visible to super_admin role
- [ ] Seed script: insert default `notificationSettings` docs on first boot (idempotent)
- [ ] Tests: admin-only auth, setting write + audit event, dispatcher honours admin override

**Success criteria:** super-admin can disable or customize any notification
without a code deploy.

---

## Phase 5 — Observability & Analytics (v2)

Lower-fidelity bullets until Phase 4 ships and we know where the operator
pressure points are:

- `notificationDispatchLog` collection (append-only, 90-day TTL)
- Resend webhook ingestion (bounce / complaint / delivered / opened / clicked) → writes back into log
- Admin dashboard widget: per-key send/bounce/open/click rates
- Alerts: super-admin email digest if any key's bounce rate > 5%
- Search + filter by recipient, key, time range

---

## Phase 6 — Multi-channel (v2)

Still email-only until this phase. The catalog already models `channels` so the
schema doesn't change — only adapters and template files are added.

- SMS `ChannelAdapter` via Africa's Talking (plan-gated by `smsNotifications`)
- Push `ChannelAdapter` via FCM topics
- In-app inbox: `users/{uid}/inbox` subcollection + real-time listener in web apps + badge count on nav
- Per-channel template files (e.g. `PaymentFailed.sms.ts`, `PaymentFailed.push.ts`)
- Extend super-admin UI with channel toggles (already modelled in `NotificationSetting.channels`)

---

## Out of scope (explicit)

Items deliberately **not** on this roadmap — revisit only if a concrete user
story appears:

- Per-organization template overrides
- A/B testing of notifications
- Per-organization localization overrides
- Scheduled/digest sends (beyond the existing `event.reminder` cron)
- Cross-tenant notification routing (each notification stays inside its org scope)

---

## Risks & mitigations

| Risk                                              | Mitigation                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Dispatcher becomes SPOF                           | Feature flag `NOTIFICATIONS_DISPATCHER_ENABLED`; old helpers keep working with flag off                       |
| Catalog drift (TS constant vs Firestore settings) | Server-only rules prevent client writes; CI lint: every key has templates for every `supportedChannels` entry |
| Silent suppression of critical email              | `userOptOutAllowed = false` on security/transactional; dispatcher unit test asserts opt-out ignored           |
| Migration regression                              | Phase 1 keeps `sendXxx` signatures unchanged; callers untouched                                               |
| Locale fallback bug                               | Exhaustive `Dictionary` typing in `I18nString`; CI check fails if any template is missing a locale            |

---

## Cross-links

- Audit findings: [`./notification-audit-2026-04-21.md`](./notification-audit-2026-04-21.md)
- Architecture design: [`./notification-system-architecture.md`](./notification-system-architecture.md)
- Delivery plan index: [`./delivery-plan/README.md`](./delivery-plan/README.md)
- Wave 7 (Communications): [`./delivery-plan/wave-7-communications.md`](./delivery-plan/wave-7-communications.md)
