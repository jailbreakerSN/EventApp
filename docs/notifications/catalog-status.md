# Notification Catalog Status

<!--
  Auto-generated — DO NOT EDIT BY HAND.
  Regenerate with: npm run notifications:status
  Source:          packages/shared-types/src/notification-catalog.ts
-->

- **Generated at:** 2026-04-22T06:24:00.529Z
- **Branch:**       `claude/email-audit-gaps-DLJuE`
- **Commit:**       `7c760716ccf0398f34ab82fb5624dbaa3e69a3e7`

## Summary

- Total catalog entries: **34**
- With at least one emitter in `apps/api/src/services`: **27**
- With at least one listener in `apps/api/src/events/listeners`: **31**
- With a resolved email template: **34**
- Entries with at least one gap: **7**
- CI integrity violations: **0**

## Truth table

| Key | Category | Trigger event | Emitter? (file:line) | Listener? (file:line) | Email template? | Supported channels | Default channels | User opt-out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `auth.email_verification` | auth | `auth.email_verification_requested` | **missing** | **missing** | `EmailVerification` | email | email | no |
| `auth.password_reset` | auth | `auth.password_reset_requested` | **missing** | **missing** | `PasswordReset` | email | email | no |
| `registration.created` | transactional | `registration.created` | `apps/api/src/services/registration.service.ts:215` | `apps/api/src/events/listeners/audit.listener.ts:11`<br>`apps/api/src/events/listeners/notification.listener.ts:25` | `RegistrationConfirmation` | email | email | no |
| `registration.approved` | transactional | `registration.approved` | `apps/api/src/services/registration.service.ts:419` | `apps/api/src/events/listeners/audit.listener.ts:45`<br>`apps/api/src/events/listeners/notification.listener.ts:72` | `RegistrationApproved` | email | email | no |
| `badge.ready` | transactional | `badge.generated` | `apps/api/src/services/badge.service.ts:156`<br>`apps/api/src/services/badge.service.ts:360` | `apps/api/src/events/listeners/audit.listener.ts:369`<br>`apps/api/src/events/listeners/notification.listener.ts:172` | `BadgeReady` | email | email | no |
| `event.cancelled` | transactional | `event.cancelled` | `apps/api/src/services/event.service.ts:379` | `apps/api/src/events/listeners/audit.listener.ts:216`<br>`apps/api/src/events/listeners/notification.listener.ts:201` | `EventCancelled` | email | email | no |
| `event.reminder` | transactional | `event.reminder_due` | **missing** | **missing** | `EventReminder` | email | email | yes |
| `payment.succeeded` | billing | `payment.succeeded` | `apps/api/src/services/payment.service.ts:441` | `apps/api/src/events/listeners/audit.listener.ts:1104`<br>`apps/api/src/events/listeners/notification.listener.ts:112` | `PaymentReceipt` | email | email | no |
| `newsletter.confirm` | transactional | `newsletter.subscriber_created` | `apps/api/src/services/newsletter.service.ts:263` | `apps/api/src/events/listeners/audit.listener.ts:613` | `NewsletterConfirmation` | email | email | no |
| `newsletter.welcome` | marketing | `newsletter.subscriber_confirmed` | `apps/api/src/services/newsletter.service.ts:335` | `apps/api/src/events/listeners/audit.listener.ts:627` | `NewsletterWelcome` | email | email | yes |
| `payment.failed` | billing | `payment.failed` | `apps/api/src/services/payment.service.ts:482` | `apps/api/src/events/listeners/audit.listener.ts:1121`<br>`apps/api/src/events/listeners/notification-dispatcher.listener.ts:248` | `PaymentFailed` | email | email | no |
| `invite.sent` | transactional | `invite.created` | `apps/api/src/services/invite.service.ts:74` | `apps/api/src/events/listeners/audit.listener.ts:818`<br>`apps/api/src/events/listeners/notification-dispatcher.listener.ts:347` | `InviteSent` | email | email | no |
| `registration.cancelled` | transactional | `registration.cancelled` | `apps/api/src/services/registration.service.ts:333` | `apps/api/src/events/listeners/audit.listener.ts:29`<br>`apps/api/src/events/listeners/notification-dispatcher.listener.ts:127` | `RegistrationCancelled` | email | email | no |
| `event.rescheduled` | transactional | `event.updated` | `apps/api/src/services/event.service.ts:270`<br>`apps/api/src/services/event.service.ts:512` | `apps/api/src/events/listeners/audit.listener.ts:149`<br>`apps/api/src/events/listeners/event-denorm.listener.ts:83` | `EventRescheduled` | email | email | no |
| `subscription.past_due` | billing | `subscription.past_due` | `apps/api/src/services/subscription.service.ts:530` | `apps/api/src/events/listeners/notification-dispatcher.listener.ts:565` | `SubscriptionPastDue` | email | email | no |
| `waitlist.promoted` | transactional | `waitlist.promoted` | `apps/api/src/services/registration.service.ts:745` | `apps/api/src/events/listeners/audit.listener.ts:407`<br>`apps/api/src/events/listeners/notification-dispatcher.listener.ts:219` | `WaitlistPromoted` | email | email | no |
| `refund.issued` | billing | `payment.refunded` | `apps/api/src/services/payment.service.ts:759` | `apps/api/src/events/listeners/audit.listener.ts:1137` | `RefundIssued` | email | email | no |
| `refund.failed` | billing | `payment.refunded` | `apps/api/src/services/payment.service.ts:759` | `apps/api/src/events/listeners/audit.listener.ts:1137` | `RefundFailed` | email | email | no |
| `member.added` | organizational | `member.added` | `apps/api/src/services/organization.service.ts:172` | `apps/api/src/events/listeners/audit.listener.ts:282`<br>`apps/api/src/events/listeners/notification-dispatcher.listener.ts:404` | `MemberUpdate` | email | email | yes |
| `member.removed` | organizational | `member.removed` | `apps/api/src/services/organization.service.ts:251` | `apps/api/src/events/listeners/audit.listener.ts:298`<br>`apps/api/src/events/listeners/notification-dispatcher.listener.ts:405` | `MemberUpdate` | email | email | yes |
| `member.role_changed` | organizational | `member.role_changed` | `apps/api/src/services/organization.service.ts:370` | `apps/api/src/events/listeners/audit.listener.ts:1159`<br>`apps/api/src/events/listeners/notification-dispatcher.listener.ts:406` | `MemberUpdate` | email | email | yes |
| `speaker.added` | organizational | `speaker.added` | `apps/api/src/services/speaker.service.ts:66` | `apps/api/src/events/listeners/audit.listener.ts:463`<br>`apps/api/src/events/listeners/notification-dispatcher.listener.ts:439` | `SpeakerAdded` | email | email | yes |
| `sponsor.added` | organizational | `sponsor.added` | `apps/api/src/services/sponsor.service.ts:62` | `apps/api/src/events/listeners/audit.listener.ts:493`<br>`apps/api/src/events/listeners/notification-dispatcher.listener.ts:469` | `SponsorAdded` | email | email | yes |
| `subscription.upgraded` | billing | `subscription.upgraded` | `apps/api/src/services/subscription.service.ts:263` | `apps/api/src/events/listeners/audit.listener.ts:1048`<br>`apps/api/src/events/listeners/effective-plan.listener.ts:32`<br>…+1 more | `SubscriptionChange` | email | email | no |
| `subscription.downgraded` | billing | `subscription.downgraded` | `apps/api/src/services/subscription.service.ts:476` | `apps/api/src/events/listeners/audit.listener.ts:1065`<br>`apps/api/src/events/listeners/effective-plan.listener.ts:36`<br>…+1 more | `SubscriptionChange` | email | email | no |
| `subscription.cancelled` | billing | `subscription.cancelled` | `apps/api/src/services/subscription.service.ts:568` | `apps/api/src/events/listeners/notification-dispatcher.listener.ts:509` | `SubscriptionChange` | email | email | no |
| `payout.created` | billing | `payout.created` | `apps/api/src/services/payout.service.ts:172` | `apps/api/src/events/listeners/audit.listener.ts:876`<br>`apps/api/src/events/listeners/notification-dispatcher.listener.ts:589` | `PayoutCreated` | email | email | no |
| `welcome` | marketing | `user.created` | `apps/api/src/services/user-lifecycle.service.ts:33` | `apps/api/src/events/listeners/notification-dispatcher.listener.ts:625` | `Welcome` | email | email | yes |
| `user.password_changed` | auth | `user.password_changed` | `apps/api/src/services/user-security-events.service.ts:35` | `apps/api/src/events/listeners/notification-dispatcher.listener.ts:649` | `PasswordChanged` | email | email | no |
| `user.email_changed` | auth | `user.email_changed` | `apps/api/src/services/user-security-events.service.ts:64` | `apps/api/src/events/listeners/notification-dispatcher.listener.ts:670` | `EmailChanged` | email | email | no |
| `event.feedback_requested` | transactional | `event.feedback_requested` | **missing** | `apps/api/src/events/listeners/notification-dispatcher.listener.ts:703` | `EventFeedbackRequested` | email, in_app | email, in_app | yes |
| `certificate.ready` | organizational | `event.certificates_issued` | **missing** | `apps/api/src/events/listeners/notification-dispatcher.listener.ts:739` | `CertificateReady` | email | email | yes |
| `subscription.expiring_soon` | billing | `subscription.expiring_soon` | **missing** | `apps/api/src/events/listeners/notification-dispatcher.listener.ts:777` | `SubscriptionExpiringSoon` | email | email | no |
| `subscription.approaching_limit` | organizational | `subscription.approaching_limit` | **missing** | `apps/api/src/events/listeners/notification-dispatcher.listener.ts:807` | `SubscriptionApproachingLimit` | email | email | yes |

## Gaps

### Coverage gaps

The following catalog entries are missing at least one of emitter, listener, or email template:

- `auth.email_verification` → triggerDomainEvent `auth.email_verification_requested` — missing: emitter, listener _(CI-waived — see `NO_EMITTER_OR_LISTENER_WAIVER` in `scripts/lib/notification-catalog-scan.ts`)_
- `auth.password_reset` → triggerDomainEvent `auth.password_reset_requested` — missing: emitter, listener _(CI-waived — see `NO_EMITTER_OR_LISTENER_WAIVER` in `scripts/lib/notification-catalog-scan.ts`)_
- `event.reminder` → triggerDomainEvent `event.reminder_due` — missing: emitter, listener _(CI-waived — see `NO_EMITTER_OR_LISTENER_WAIVER` in `scripts/lib/notification-catalog-scan.ts`)_
- `event.feedback_requested` → triggerDomainEvent `event.feedback_requested` — missing: emitter
- `certificate.ready` → triggerDomainEvent `event.certificates_issued` — missing: emitter
- `subscription.expiring_soon` → triggerDomainEvent `subscription.expiring_soon` — missing: emitter
- `subscription.approaching_limit` → triggerDomainEvent `subscription.approaching_limit` — missing: emitter

