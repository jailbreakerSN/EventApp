# Error Disambiguation Rollout Plan

> Status: **proposed** as of 2026-04-22. Companion to `error-handling.md` and the duplicate-registration fix shipped in PR `claude/fix-duplicate-registration-error-kaAJd`.

## Why this exists

`error-handling.md` defined the contract for `details.reason` discriminators and shipped the reference implementation for `REGISTRATION_CLOSED`. The duplicate-registration fix added the second (`CONFLICT.duplicate_registration`). A backend audit (2026-04-22) and a frontend audit (same day) surfaced the next ~40 sites that should follow the same pattern, and ~12 mutation sites that violate the preflight contract.

This document is the rollout plan for closing those gaps in priority order. Each item is a small, isolated PR — they intentionally don't depend on each other so they can ship in parallel.

---

## Phase 1 — Type the discriminators

Add reason unions to `packages/shared-types/src/event-availability.ts` (or split into `packages/shared-types/src/error-reasons.ts` once the file gets >100 LOC). Mirror them in `apps/api/src/errors/app-error.ts` so service code is type-checked at the throw site.

```ts
// shared-types
export type RegistrationConflictReason =
  | "duplicate_registration" // shipped
  | "user_already_member" // invite.service.ts:47
  | "invite_already_pending" // invite.service.ts:53
  | "concurrent_refund_in_progress" // payment.service.ts:611
  | "promo_code_duplicate" // promo-code.service.ts:46
  | "slug_taken" // organization.service.ts:24
  | "org_ownership_limit" // organization.service.ts:31
  | "speaker_already_assigned" // speaker.service.ts:33
  | "lead_already_scanned"; // sponsor.service.ts:192

export type RegistrationStateReason =
  | "registration_already_cancelled" // registration.service.ts:295
  | "registration_already_checked_in" // registration.service.ts:298
  | "registration_invalid_status_for_approval" // registration.service.ts:394
  | "registration_not_confirmed_for_badge"; // badge.service.ts:323,390

export type EventStateReason =
  | "event_invalid_status_for_update" // event.service.ts:224
  | "event_status_conflict" // event.service.ts:371 (publish/cancel)
  | "event_status_immutable_tickets" // event.service.ts:584
  | "event_status_immutable_zones"; // event.service.ts:722

export type InviteStateReason =
  | "invite_already_processed" // invite.service.ts:103
  | "invite_expired" // invite.service.ts:109
  | "invite_email_mismatch" // invite.service.ts:114
  | "invite_invalid_status_for_revoke"; // invite.service.ts:245

export type PaymentStateReason =
  | "payment_already_fully_refunded" // payment.service.ts:689
  | "payment_invalid_status_for_refund" // payment.service.ts:692
  | "provider_manual_refund_required"; // payment.service.ts:654

export type PromoCodeReason =
  | "promo_code_inactive" // promo-code.service.ts:93
  | "promo_code_expired" // promo-code.service.ts:98
  | "promo_code_exhausted" // promo-code.service.ts:103
  | "promo_code_invalid_ticket_type"; // promo-code.service.ts:108

export type PlanLimitReason =
  | "max_participants_per_event" // registration.service.ts:99
  | "max_active_events" // event.service.ts:953
  | "scheduled_downgrade_event_limit" // event.service.ts:988
  | "max_organization_members" // organization.service.ts:148, invite.service.ts:39,137, subscription.service.ts:356
  | "scheduled_downgrade_member_limit" // subscription.service.ts:350
  | "storage_limit_exceeded"; // subscription.service.ts:404
```

### Naming pattern

`snake_case`, prefixed by domain when ambiguous. `invite_expired` (not `expired`). Mirrors the established `RegistrationUnavailableReason` precedent.

### Constructor pattern

```ts
export class ConflictError extends AppError {
  constructor(message: string, details?: { reason?: string } & Record<string, unknown>) {
    super({ message, code: ERROR_CODES.CONFLICT, statusCode: 409, details });
  }
}

// Sugar for high-traffic conflicts:
export class DuplicateRegistrationError extends ConflictError {
  /* shipped */
}
export class UserAlreadyMemberError extends ConflictError {
  constructor(orgId: string, userId: string) {
    super("Cet utilisateur est déjà membre de l'organisation", {
      reason: "user_already_member" satisfies RegistrationConflictReason,
      organizationId: orgId,
      userId,
    });
  }
}
```

`ValidationError` and `PlanLimitError` get the same treatment.

---

## Phase 2 — Backend rollout (priority-ordered)

| Priority | Site                                                                                       | Reason                                                              | Impact                                                                             |
| -------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **P1**   | `invite.service.ts:39,137` + `organization.service.ts:148` + `subscription.service.ts:356` | `max_organization_members`                                          | Same code thrown from 4 sites; a single i18n branch ends 4 confusing toasts        |
| **P1**   | `event.service.ts:953`                                                                     | `max_active_events`                                                 | Generic plan-limit copy hides whether to upgrade for events vs members             |
| **P1**   | `invite.service.ts:47,53`                                                                  | `user_already_member`, `invite_already_pending`                     | High-frequency CONFLICT pair on the team-invite page                               |
| **P2**   | `event.service.ts:371`                                                                     | `event_status_conflict`                                             | Blocks publish/cancel on multiple statuses with same generic copy                  |
| **P2**   | `payment.service.ts:611`                                                                   | `concurrent_refund_in_progress`                                     | Currently looks like a duplicate-action UX bug; explaining the lock unblocks staff |
| **P2**   | `registration.service.ts:295,298`                                                          | `registration_already_cancelled`, `registration_already_checked_in` | Affects the cancel button on the participant "My events" page                      |
| **P3**   | promo-code, badge, speaker, sponsor reasons                                                | various                                                             | Lower-traffic surfaces; ship after P1/P2 land                                      |

**Each PR pattern:**

1. Add the reason to the union in `shared-types`.
2. Add a typed factory subclass in `app-error.ts` (or pass `details` directly).
3. Update the throw site.
4. Add `errors.<CODE>.reasons.<reason>` copy in fr/en/wo for the apps that surface it.
5. Add a unit test in `app-error.test.ts` mirroring the `DuplicateRegistrationError` test.
6. Run the audit subagents (`@security-reviewer`, `@l10n-auditor`).

---

## Phase 3 — Frontend rollout

### 3a — Migrate blocking `toast.error(...)` to `<InlineErrorBanner>`

Per `error-handling.md` § "The four channels": toasts are for non-blocking confirmations only. Blocking submit failures must use `<InlineErrorBanner>` resolved via `useErrorHandler`.

Audit found ~12 violations, all in `apps/web-backoffice`. Migration order:

| Priority | File:line range                                                                 | Scope                                                                                                            |
| -------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **P1**   | `(dashboard)/events/[eventId]/page.tsx:302,327,346,376,575,...`                 | ~30 sites of `toast.error(getErrorMessage(...))` — single biggest offender                                       |
| **P1**   | `(dashboard)/events/[eventId]/checkin/page.tsx:334,345`                         | Check-in is the most operationally critical surface                                                              |
| **P2**   | `(dashboard)/badges/page.tsx:162,171,177,189`                                   | Bulk badge generation; the `:177` "select template first" should become a disabled button + tooltip, not a toast |
| **P2**   | `(dashboard)/venues/[page,page-id].tsx:89,179`                                  | Generic create/update venue errors                                                                               |
| **P3**   | `(dashboard)/admin/plans/page.tsx:72`, `(dashboard)/notifications/page.tsx:145` | Lower-traffic admin surfaces                                                                                     |

The participant app is already clean (verified in the duplicate-registration fix audit).

### 3b — Add preflights for known-derivable preconditions

Per `error-handling.md` § "Preflight": disabled buttons + tooltip + blocking state beats letting the user submit a known-invalid request.

| Priority | Mutation site                                                           | Preconditions to check                                                        | Pattern                                                                                 |
| -------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **P1**   | `web-backoffice/use-events.ts:75` (publish event)                       | `status === 'draft'`, `ticketTypes.length > 0`, capacity vs `registeredCount` | Disable the publish button + tooltip explaining why                                     |
| **P1**   | `web-backoffice/use-events.ts:91` (cancel event)                        | `status !== 'completed' && status !== 'cancelled'`                            | Disable + tooltip                                                                       |
| **P1**   | `web-backoffice/use-organization.ts:52` (invite member)                 | `currentMembers < plan.memberLimit` (already tracked by `usePlanGating`)      | Wrap CTA in `<PlanGate feature="..." />` or use `usePlanGating().checkLimit("members")` |
| **P2**   | `web-backoffice/use-registrations.ts:23,31,39` (approve/cancel/promote) | Registration status mismatch                                                  | Disable per-row actions when status disallows them                                      |
| **P2**   | `web-backoffice/use-badges.ts:71` (bulk generate)                       | `selectedEventId && selectedTemplateId && registrations.length > 0`           | Disable the button until valid                                                          |
| **P2**   | `web-backoffice/use-checkin.ts:54` (manual check-in)                    | Badge expiry, scan window                                                     | Already partially handled via QR validity; surface earlier in UI                        |
| **P3**   | `web-backoffice/use-promo-codes.ts:34` (create promo)                   | Code uniqueness, `dateFrom < dateTo`                                          | Inline `<FieldError>` not toast                                                         |

### 3c — Reason-aware action buttons

When the resolved error carries a `descriptor.reason`, the `<InlineErrorBanner>` actions should be reason-targeted (e.g. `duplicate_registration` → "Voir mes inscriptions", `event_invalid_status_for_update` → "Voir l'événement"). Pattern shipped in the duplicate-registration fix at `apps/web-participant/src/app/(authenticated)/register/[eventId]/page.tsx`.

Standard action labels live in `errors.actions.*` — add them as needed:

- `viewMyRegistrations` (shipped, participant only)
- `viewEvent` — for event-state conflicts
- `viewMembers` — for member-related conflicts
- `viewBilling` — for plan-limit reasons (already covered by `upgradePlan`)
- `retry` (shipped, participant) — for transient/race conflicts

---

## Phase 4 — Wire observability (deferred)

Per `error-handling.md` § "Observability": `setErrorReporter()` is in place but no vendor is registered yet. Wiring Sentry / Glitchtip is a one-line change in each app's client entry. Out of scope for the rollout above; trackable as `TASK-OBS-1`.

---

## Verification gates per PR

Every PR in this rollout must pass:

1. `cd apps/api && npx vitest run` — full test suite green.
2. `cd packages/shared-types && npx vitest run` — i18n coverage test catches missing fr/en keys.
3. `@security-reviewer` agent reports no new violations.
4. `@l10n-auditor` agent reports no hardcoded strings.
5. The new error reason is documented in `error-handling.md` § "Disambiguated errors" if it introduces a new code or material domain.

---

## Out-of-scope (tracked separately)

- Pre-existing hardcoded fallback strings in `use-error-handler.ts` (participant `:159`, backoffice `:124`) — flagged by `@l10n-auditor` 2026-04-22, not part of duplicate-registration fix.
- French-only `ApiError` constructor messages in participant `api-client.ts` — only surface when a known code has no catalog entry; low priority.
- Wiring Sentry / Glitchtip / Datadog RUM as the error reporter — see Phase 4.
