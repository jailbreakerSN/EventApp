# Teranga — Notification Coverage Audit

**Audit date:** 2026-04-21
**Branch:** `claude/setup-resend-emails-nIwYV`
**Scope:** Email notifications across every user journey (auth, events, payments, billing, team, admin, messaging)
**Method:** Journey-by-journey walkthrough of service code (`apps/api/src/services/`), domain events (`apps/api/src/events/domain-events.ts`), email templates (`apps/api/src/services/email/templates/`), and user-preferences types (`packages/shared-types/src/user.types.ts`).

Severity legend: **P0** ship-blocker (revenue, security, audit-critical) · **P1** must-fix this quarter · **P2** hardening · **P3** nice-to-have.
Effort legend: **XS** <1h · **S** 1-4h · **M** half-day · **L** 1-2d · **XL** ≥3d.

---

## 1. Executive Summary

Ten email notifications ship today via hand-written `emailService.sendXxx()` helpers. The platform-wide walk-through found roughly **eighteen** critical or high-priority gaps, **zero** super-admin kill-switch capability, a **coarse-grained** user-preference model (three marketing buckets, no per-notification opt-out), and **no channel abstraction** (email-only, with no plumbing for the SMS / push / in-app channels the product already plans).

| Journey cluster               | Shipped | P0 gaps | P1 gaps | P2/P3 gaps | Notes                                    |
| ----------------------------- | ------- | ------- | ------- | ---------- | ---------------------------------------- |
| Auth & account                | 2       | 0       | 3       | 0          | security-critical alerts missing         |
| Event lifecycle (participant) | 5       | 1       | 2       | 0          | core UX — self-cancel email missing      |
| Payments                      | 1       | 1       | 2       | 0          | revenue-critical — failed-charge silence |
| Billing / subscription        | 0       | 1       | 3       | 0          | revenue-retention entirely absent        |
| Team & invites                | 0       | 1       | 2       | 0          | blocks Wave 8 portals                    |
| Organizational updates        | 2       | 0       | 4       | 0          | org awareness                            |
| Platform admin                | 0       | 0       | 0       | 2          | super-admin tooling                      |
| Messaging / feed              | 0       | 0       | 0       | 2          | social                                   |
| **Totals**                    | **10**  | **4**   | **16**  | **4**      |                                          |

**Top 3 risks (all P0):**

1. **No `payment.failed` email.** When a Wave / Orange Money charge declines the payer gets zero feedback — the in-app screen is the only signal. Expected abandoned-transaction losses; first production cohort will hit this the moment paid tickets go live.
2. **No `subscription.past_due` email.** Orgs whose auto-renewal fails silently churn. The retention hook — a branded email with a "pay now" CTA — does not exist.
3. **No invite emails.** `invite.created` already emits but the invitee receives nothing. This blocks the full portal onboarding paths (speaker / co-organizer / sponsor / staff) planned for Wave 8.

**Posture assessment:** The transactional foundation (Resend + react-email + DMARC + RFC-8058 unsubscribe + branded `/auth/action`) is solid. What's missing is (a) coverage across the remaining journeys, (b) a super-admin control plane to enable / disable / customize without a code deploy, and (c) a channel-agnostic architecture so SMS / push / in-app slot in without re-plumbing every call site.

---

## 2. Shipped notifications (baseline)

All ten shipped helpers live in `apps/api/src/services/email.service.ts` and render templates from `apps/api/src/services/email/templates/`.

| #   | Key                       | Helper + line                       | Trigger                                   | Recipient       | Locale source  | Template                       |
| --- | ------------------------- | ----------------------------------- | ----------------------------------------- | --------------- | -------------- | ------------------------------ |
| S1  | `registration.created`    | `sendRegistrationConfirmation` L402 | Registration document insert              | Participant     | user profile   | `RegistrationConfirmation.tsx` |
| S2  | `registration.approved`   | `sendRegistrationApproved` L417     | Organizer approves a pending registration | Participant     | user profile   | `RegistrationApproved.tsx`     |
| S3  | `badge.ready`             | `sendBadgeReady` L429               | Badge PDF generated + signed URL issued   | Participant     | user profile   | `BadgeReady.tsx`               |
| S4  | `event.cancelled`         | `sendEventCancelled` L438           | Organizer cancels an event                | All registrants | user profile   | `EventCancelled.tsx`           |
| S5  | `event.reminder`          | `sendEventReminder` L447            | 24-h-before scheduled cron                | Registrants     | user profile   | `EventReminder.tsx`            |
| S6  | `payment.succeeded`       | `sendPaymentReceipt` L456           | Payment marked `succeeded`                | Payer           | user profile   | `PaymentReceipt.tsx`           |
| S7  | `newsletter.welcome`      | `sendWelcomeNewsletter` L468        | Post-confirmation subscriber activation   | Subscriber      | form input     | `NewsletterWelcome.tsx`        |
| S8  | `auth.email_verification` | `sendEmailVerification` L482        | Sign-up / resend verification             | Self            | request header | `EmailVerification.tsx`        |
| S9  | `auth.password_reset`     | `sendPasswordReset` L499            | Forgot-password form                      | Self            | request header | `PasswordReset.tsx`            |
| S10 | `newsletter.confirm`      | `sendNewsletterConfirmation` L516   | Newsletter subscribe POST                 | New subscriber  | form input     | `NewsletterConfirmation.tsx`   |

All ten pass through `sender.registry.ts` (DMARC-aligned `From:` per env) and `render.ts` (react-email → HTML + plaintext). RFC-8058 one-click unsubscribe is injected automatically on marketing-category sends.

---

## 3. P0 gaps — revenue-critical + security-critical

| #         | Journey         | Key                      | Trigger                                                                 | Recipient                                    | Existing domain event                                                                  | Needs                                                                                                                                                     | Effort |
| --------- | --------------- | ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **P0-N1** | Payments        | `payment.failed`         | Mobile-money charge declined                                            | Payer                                        | `payment.failed` — already emitted (`apps/api/src/events/domain-events.ts:261`)        | Listener + react-email template `PaymentFailed.tsx` + retry CTA link                                                                                      | S      |
| **P0-N2** | Billing         | `subscription.past_due`  | Auto-renewal failure caught by billing cron                             | Org billing contacts                         | **None** — cron service not yet built                                                  | New scheduled cron → emit new `subscription.past_due` event → listener + template `SubscriptionPastDue.tsx`                                               | M      |
| **P0-N3** | Team & invites  | `invite.sent`            | Organizer invites a speaker / co-organizer / sponsor / staff            | Invitee (by email — may have no account yet) | `invite.created` — already emitted (`apps/api/src/events/domain-events.ts:510`)        | Listener + template `InviteSent.tsx` (handles all 4 role variants via `params.role`); must sign the invite token and bake it into the accept link         | S      |
| **P0-N4** | Event lifecycle | `registration.cancelled` | Either (a) participant cancels or (b) organizer cancels on their behalf | Participant                                  | `registration.cancelled` — already emitted (`apps/api/src/events/domain-events.ts:21`) | Listener + 2 template variants (`RegistrationCancelledBySelf.tsx` = confirmation; `RegistrationCancelledByOrganizer.tsx` = apology + refund info if paid) | S      |

---

## 4. P1 gaps — must-fix this quarter

| #      | Journey         | Key                                                       | Trigger                                                | Recipient                   | Existing domain event                                                                                       | Needs                                                                                      | Effort |
| ------ | --------------- | --------------------------------------------------------- | ------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| P1-N1  | Event lifecycle | `event.rescheduled`                                       | `event.updated` where `startDate` or `endDate` changed | All registered participants | `event.updated` (L121) — must be detected in listener                                                       | Listener (diff dates) + template `EventRescheduled.tsx` (reuses cancelled-event styling)   | M      |
| P1-N2  | Event lifecycle | `waitlist.promoted`                                       | Participant lifted from waitlist to confirmed          | Promoted participant        | `waitlist.promoted` (L168) — already emitted                                                                | Listener + template `WaitlistPromoted.tsx` with registration CTA + 48h hold deadline       | S      |
| P1-N3  | Auth            | `welcome`                                                 | First successful sign-up (email or Google)             | Self                        | **None** — need new `user.created` emit from `auth.trigger.ts` (functions)                                  | Emit event + listener + template `Welcome.tsx` with platform orientation links             | M      |
| P1-N4  | Auth            | `password.changed`                                        | `confirmPasswordReset` or self-service password change | Self                        | **None** — need new `user.password_changed` event                                                           | Emit event + listener + template `PasswordChanged.tsx` (security alert with "not me?" CTA) | S      |
| P1-N5  | Auth            | `email.changed`                                           | Email-address change via self-service                  | **Old address**             | **None** — need new `user.email_changed` event                                                              | Emit event + listener + template `EmailChanged.tsx` sent to OLD address (security alert)   | S      |
| P1-N6  | Payments        | `refund.issued` / `refund.failed`                         | `payment.refunded`                                     | Payer                       | `payment.refunded` (L268) — already emitted                                                                 | Listener + templates `RefundIssued.tsx` / `RefundFailed.tsx`                               | S      |
| P1-N7  | Team            | `member.added` / `member.removed` / `member.role_changed` | Org owner adds / removes / changes role                | Target member + org owner   | `member.added` (L203), `member.removed` (L208), `member.role_changed` (L213) — all already emitted          | 3 listeners + template `MemberUpdate.tsx` (variant via `params.kind`)                      | M      |
| P1-N8  | Team            | `speaker.added` / `sponsor.added`                         | Party added to an event                                | The added party             | `speaker.added` (L349), `sponsor.added` (L364) — already emitted                                            | 2 listeners + templates `SpeakerAdded.tsx` / `SponsorAdded.tsx` with portal onboarding CTA | M      |
| P1-N9  | Billing         | `subscription.upgraded` / `downgraded` / `cancelled`      | Plan change via subscription API                       | Org billing contact         | `subscription.upgraded` (L556), `subscription.downgraded` (L562), plus a new `subscription.cancelled` event | 3 listeners + template `SubscriptionChange.tsx` (variant via `params.kind`)                | M      |
| P1-N10 | Organizational  | `payout.created`                                          | Payout scheduled to organizer                          | Organizer / org billing     | `payout.created` (L536) — already emitted                                                                   | Listener + template `PayoutCreated.tsx` with expected-settlement date                      | S      |

---

## 5. P2 / P3 backlog

| #     | Journey        | Key                               | Severity | Notes                                                                           |
| ----- | -------------- | --------------------------------- | -------- | ------------------------------------------------------------------------------- |
| P2-N1 | Messaging      | `message.received` (daily digest) | P2       | Per-message email would be spammy; digest only                                  |
| P2-N2 | Platform admin | `super_admin.daily_digest`        | P2       | New orgs, refund anomalies, bounce spikes — keeps admin close to health signals |
| P3-N1 | Feed           | `feed.mention` / `feed.reply`     | P3       | In-app primary; email digest optional                                           |
| P3-N2 | Sessions       | `session.reminder`                | P3       | 1h-before reminder for speakers and registrants                                 |

---

## 6. Data-flow pattern mapping

The gaps split cleanly by whether the driving domain event already exists. ~60 % of them are just "wire a listener + template"; the rest need new domain events first.

| Gap                                     | Existing domain event                      | File : line            | Listener needed                                                         | Template to create                                                         |
| --------------------------------------- | ------------------------------------------ | ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P0-N1 `payment.failed`                  | `payment.failed`                           | `domain-events.ts:261` | `payment-notification.listener.ts`                                      | `PaymentFailed.tsx`                                                        |
| P0-N2 `subscription.past_due`           | **none** (new cron + event)                | —                      | `billing-notification.listener.ts`                                      | `SubscriptionPastDue.tsx`                                                  |
| P0-N3 `invite.sent`                     | `invite.created`                           | `domain-events.ts:510` | `invite-notification.listener.ts`                                       | `InviteSent.tsx`                                                           |
| P0-N4 `registration.cancelled`          | `registration.cancelled`                   | `domain-events.ts:21`  | extend `registration-notification.listener.ts`                          | `RegistrationCancelledBySelf.tsx` + `RegistrationCancelledByOrganizer.tsx` |
| P1-N1 `event.rescheduled`               | `event.updated`                            | `domain-events.ts:121` | extend `event-notification.listener.ts`                                 | `EventRescheduled.tsx`                                                     |
| P1-N2 `waitlist.promoted`               | `waitlist.promoted`                        | `domain-events.ts:168` | `waitlist-notification.listener.ts`                                     | `WaitlistPromoted.tsx`                                                     |
| P1-N3 `welcome`                         | **none** (new `user.created`)              | —                      | `user-notification.listener.ts`                                         | `Welcome.tsx`                                                              |
| P1-N4 `password.changed`                | **none** (new)                             | —                      | → same listener                                                         | `PasswordChanged.tsx`                                                      |
| P1-N5 `email.changed`                   | **none** (new)                             | —                      | → same listener                                                         | `EmailChanged.tsx`                                                         |
| P1-N6 `refund.*`                        | `payment.refunded`                         | `domain-events.ts:268` | extend `payment-notification.listener.ts`                               | `RefundIssued.tsx` + `RefundFailed.tsx`                                    |
| P1-N7 member events                     | L203 / L208 / L213                         | existing               | `member-notification.listener.ts`                                       | `MemberUpdate.tsx`                                                         |
| P1-N8 `speaker.added` / `sponsor.added` | L349 / L364                                | existing               | `speaker-notification.listener.ts` + `sponsor-notification.listener.ts` | `SpeakerAdded.tsx` / `SponsorAdded.tsx`                                    |
| P1-N9 subscription changes              | L556 / L562 + new `subscription.cancelled` | existing + new         | → `billing-notification.listener.ts`                                    | `SubscriptionChange.tsx`                                                   |
| P1-N10 `payout.created`                 | `payout.created`                           | `domain-events.ts:536` | `payout-notification.listener.ts`                                       | `PayoutCreated.tsx`                                                        |

**Inference:** Phase 2 (listener coverage) is 14 templates + ~8 new listener files + 4 new domain events. Roughly one developer-week.

---

## 7. Channel analysis

Today every shipped notification is **email only**. The product explicitly plans three additional channels:

| Channel | Status today                                                                                                        | Blockers                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| SMS     | Not plumbed. Plan-gated by `smsNotifications` feature flag (see `packages/shared-types/src/organization.types.ts`). | Needs Africa's Talking provider integration + `ChannelAdapter` implementation |
| Push    | FCM SDK is present in the Flutter app for device tokens but no server-side topic management.                        | Needs topic-subscribe per notification key + `ChannelAdapter`                 |
| In-app  | Not plumbed. Would use `users/{uid}/inbox` Firestore subcollection + real-time listener.                            | Needs collection schema + rules + listener + UI inbox                         |

**Implication:** The v1 catalog must carry `supportedChannels` and `defaultChannels` on every entry from day one. Adding a channel later must be a matter of registering a new `ChannelAdapter` — no changes to dispatcher, listeners, or templates at the call site.

---

## 8. User-preference gap

Today `notificationPreferences` on the user document is coarse-grained — something like:

```ts
notificationPreferences?: {
  emailRegistration: boolean;
  emailReminder: boolean;
  emailMarketing: boolean;
};
```

Problems:

- **No per-notification opt-out** — a user who wants event reminders but not payout emails has no option.
- **No per-channel preference** — once SMS / push ship, the user has no way to prefer one over another for the same key.
- **No category vs. key distinction** — "marketing" is treated as a single toggle, but the platform already has multiple marketing notifications (newsletter welcome, plan-upgrade promos, feature announcements) that should be togglable individually.

**Target shape (v1):**

```ts
notificationPreferences?: {
  byKey: Record<string, boolean>;           // per-notification override
  byCategory?: Partial<Record<NotificationCategory, boolean>>; // quick master switches
  byChannel?: Partial<Record<NotificationChannel, boolean>>;   // v2
};
```

Dispatcher consults `byKey` first (most specific), then `byCategory` (marketing pause), then the catalog default. Security/transactional keys bypass both (see architecture doc).

---

## 9. Admin-control gap

A super-admin cannot today:

- Disable a misbehaving notification without a code deploy
- Override the subject line for a campaign without editing a template
- Toggle a channel off (once multi-channel ships) without a code change
- Inspect which notifications were sent in the last N hours
- See bounce / complaint rates per notification

This is a P0-shaped operational gap for GA — the first time a bug spams users the team needs a kill-switch, not a hotfix deploy.

---

## 10. Observability gap

There is no database record of what was dispatched. We currently rely on the Resend dashboard, which:

- has no notion of our `key` taxonomy
- shows only raw email-address grouping
- cannot correlate a dispatch to the originating domain event or request
- expires detailed logs after 90 days

Phase 5 adds `notificationDispatchLog` (append-only, 90-day TTL) + Resend webhook ingestion (bounce / complaint / delivered / opened / clicked) so every key has first-party delivery metrics.

---

## 11. Cross-links

- Architecture design: [`./notification-system-architecture.md`](./notification-system-architecture.md)
- Implementation roadmap: [`./notification-system-roadmap.md`](./notification-system-roadmap.md)
- Deliverability runbook: [`./email-deliverability.md`](./email-deliverability.md)
- Wave 7 (Communications): [`./delivery-plan/wave-7-communications.md`](./delivery-plan/wave-7-communications.md)
