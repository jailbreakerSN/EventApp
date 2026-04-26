# ADR-0017: Registration / Payment state machine

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

Wave 6 introduced paid tickets behind PayDunya hosted-checkout. The flow is
asynchronous (the participant is bounced to the provider and we only learn the
real outcome via an IPN) which forces every paid registration into a two-phase
shape: a placeholder `Registration` is created up-front so the seat is held
during the handoff, and we update it when the IPN lands.

This produced four fault lines that surfaced as user-facing incoherences after
the first payment-stuck-in-`processing` incident on 2026-04-25:

1. **Badge surfaced for `pending_payment`** — `my-events` showed "Voir mon badge"
   on a registration whose QR is unsigned, so the participant downloaded a
   no-op QR that the scanner would refuse.
2. **CTA on the public event page never adapted** — `S'inscrire` always pointed
   to `/register/<id>` and the register page then redirected the user back to
   their own badge, looping the participant through a flow that didn't match
   their state.
3. **No way out** — a stuck `pending_payment` registration could not be
   abandoned, so the participant was held hostage by a placeholder until the
   timeout job ran (best case 30 min, worst case never if the job was
   misconfigured), and during that window any retry attempt was rejected as
   "registration already exists".
4. **Two parallel state machines (Registration + Payment) drifted** — the
   `onPaymentTimeout` Cloud Function only flipped the Payment to `failed`,
   leaving Registration in `pending_payment`; subsequently the Registration
   was orphaned because no listener watched Payment status changes back to
   sync the Registration row.

The 2026-04-25 audit (`docs/audit-2026-04-25/REPORT.md`) and the badge journey
review (`docs/badge-journey-review-2026-04-20.md`) both flagged these as
P0-blockers for Wave 6 launch. We need a contract that is single-sourced,
enforced at the service boundary, and visible in the UI without each surface
re-implementing the matrix.

---

## Decision

> **We will treat Registration and Payment as two coupled state machines with
> a small, fully-enumerated set of legal transitions, denormalize `paymentId`
> onto Registration, and surface state-aware affordances in every UI that
> shows registrations.**

Concrete shape:

- **Registration states (terminal in bold):** `pending`, `pending_payment`,
  `waitlisted`, `confirmed`, `checked_in`, **`cancelled`**, **`refunded`**.
  `refund_requested` is a transient sub-state inside `confirmed` that
  expresses "refund pipeline in flight, seat still counts".
- **Payment states (terminal in bold):** `pending`, `processing`,
  **`succeeded`**, **`failed`**, **`expired`**, **`refunded`**.
- **Coupling rule:** for every Registration in `pending_payment` there is
  exactly one non-terminal Payment, and `Registration.paymentId` equals
  that payment's id. Once the Payment reaches a terminal state, the
  Registration must be flipped to its mirror state in the SAME transaction
  that flips the Payment.
- **Mirror table** (the only legal Payment→Registration transitions):

  | Payment terminal | Registration becomes | Trigger |
  |---|---|---|
  | `succeeded` | `confirmed` (QR signed, registeredCount++) | `payment.succeeded` IPN |
  | `failed` | `cancelled` (no counter change — never incremented) | `payment.failed` IPN |
  | `expired` | `cancelled` | `onPaymentTimeout` cron OR `cancelPending` user action |
  | `refunded` | `refunded` | `payment.refunded` IPN |

- **Counter invariant (P1-04):** `event.registeredCount` is incremented
  ONLY on `payment.succeeded`. Placeholder creation does NOT touch the
  counter — the seat hold lives in the unique `eventId+userId` Registration
  row, not in the counter.
- **Three legal write paths** that a Registration can transition through:
  1. **Provider IPN** (`payment.service:onIpn`) — server-to-server, owns
     `pending_payment → confirmed | cancelled | refunded`.
  2. **Cron timeout** (`functions:onPaymentTimeout`) — covers stuck
     `pending` AND `processing` Payments past TTL, owns
     `pending_payment → cancelled` via `Payment.status = 'expired'`.
  3. **User abandon** (`registration.service:cancelPending`) — owns
     `pending_payment → cancelled` for explicit user action; emits
     `payment.expired` with `reason: "user_cancelled"`.
- **No other code path may write a Registration status.** Direct repository
  updates are forbidden — all transitions go through service methods that
  emit the matching domain event.

---

## State diagram

```
Registration                              Payment
============                              =======

      ┌────────────┐                       ┌─────────┐
      │  pending   │ (approval-required)   │ pending │
      └─────┬──────┘                       └────┬────┘
            │ organizer.approve                 │ initiatePayment()
            ▼                                   ▼
      ┌────────────┐  user pays   ┌──────────────┐
      │ pending_   │◄─────────────│  processing  │
      │ payment    │              └──────┬───────┘
      └─────┬──────┘                     │
            │                            │
   ┌────────┼─────────────┐              │
   │ IPN.succeeded        │              │
   │ tx { reg=confirmed   │   IPN.failed │
   │      pay=succeeded   │  ─OR─        │
   │      counter++       │   timeout    │
   │      qr=signed }     │  ─OR─        │
   ▼                      │   user_cancel│
┌──────────────┐          ▼              │
│  confirmed   │   ┌─────────────┐       │
└──────┬───────┘   │  cancelled  │◄──────┘
       │           └─────────────┘   tx { reg=cancelled
   scan│ checkin                          pay=failed|expired }
       ▼
┌──────────────┐
│  checked_in  │       ┌────────────┐
└──────────────┘       │  refunded  │
       ▲               └────────────┘
       │ refund-pipeline ▲
       │ IPN.refunded   │
       └────────────────┘
```

The diagram intentionally omits two transient sub-states to keep the load-bearing
shape readable: `refund_requested` (lives inside `confirmed`, no counter change)
and re-tries of the IPN (idempotent — landing the same `payment.succeeded`
twice is a no-op because the Registration is already `confirmed`).

---

## UI affordance contract

Every surface that shows a Registration (event detail CTA, register page,
my-events list, my-events badge page, calendar action menu) MUST adapt
its primary action by status. The matrix is single-sourced; surfaces
re-implement only the rendering, never the rules.

| Status | Primary action | Secondary actions | Forbidden |
|---|---|---|---|
| `pending_payment` | **Reprendre le paiement** (link to provider via `POST /v1/payments/:id/resume`) | Abandonner (calls `cancelPending`), Détails de l'événement | Voir mon badge, register-again link, anything that suggests the seat is locked in |
| `confirmed` | **Voir mon badge** (QR + offline save) | Détails, Programme, Annuler, Demander un remboursement (paid only) | Re-register CTA |
| `checked_in` | **Voir mon badge** (still useful as proof of attendance) | Détails, Programme | Re-register, refund |
| `pending` (approval) | **En attente de validation** (informational, non-clickable) | Détails, Annuler | Voir mon badge |
| `waitlisted` | **Sur liste d'attente** (informational) | Quitter la liste, Détails | Voir mon badge, register CTA |
| `cancelled` | none (or "Re-register" if seats still available) | Détails | Voir mon badge, refund |
| `refunded` | none | Détails | Voir mon badge |

The badge route (`/my-events/:registrationId/badge`) defends in depth: even
when reached via a bookmarked URL, it short-circuits to "Badge indisponible"
unless `status ∈ {confirmed, checked_in}`.

The public event-detail CTA (`apps/web-participant/.../event-register-cta.tsx`)
is a Client Component that hydrates against the user's most-recent
Registration via `GET /v1/registrations/me/event/:eventId`; the SSR shell
ships the default CTA so signed-out visitors and crawlers see the cheap path.

---

## Reasons

| Concern | Two coupled state machines (chosen) | Single merged status | Boolean flags on Registration |
|---|---|---|---|
| Source of truth | Provider IPN owns Payment; service layer owns Registration mirror — no ambiguity. | Provider would have to know about Registration concepts (refund_requested, waitlisted) — leaks across boundary. | Combinatorial explosion (4 booleans = 16 states, most illegal). |
| Counter invariant | `payment.succeeded` is the single increment trigger; trivial to audit. | Couldn't decouple seat-hold from confirmed seat. | Easy to double-increment under retry. |
| Idempotency under IPN replay | Mirror table makes the legal transition set tiny — replaying is a no-op. | Same outcome but harder to verify — requires re-deriving the mirror at every read. | Each flag transition needs its own idempotency story. |
| Audit trail | Each transition emits a typed domain event (`payment.expired`, `registration.cancelled`). | Single `status_changed` event loses semantic granularity. | Same problem. |
| UI affordance derivation | A 7-row switch in `<ExistingRegistrationView>` covers every case exactly once. | A status enum that mixes payment + reg concerns forces the UI to disambiguate. | UI has to and-or 4 booleans to render. |
| Failure isolation | If the IPN handler crashes mid-tx, both sides remain `pending_payment` / `processing` and the cron sweeps them. | Partial state — Reg `confirmed` with Payment `processing` is unrepresentable here. | Easy to land in inconsistent flag combinations. |

---

## Alternatives considered

### Alt A — Merge Registration and Payment into one document

- **Pro:** One Firestore document per registration, simpler reads.
- **Con:** Leaks payment concerns into the Registration security rules
  (organizers need read-access to Registration but not to provider IDs,
  receipts, IPN history); also forces a unique-constraint workaround for
  re-tries because the Registration doc would already exist.
- **Why rejected:** The provider IPN flow is bursty (a single failed payment
  can trigger 4–6 IPN deliveries) and we need an idempotency surface that
  is local to the Payment row; collapsing the two surfaces means every
  IPN write contends on the Registration document and can lose seat-hold
  semantics under retry.

### Alt B — Boolean flags (`isPaid`, `isCheckedIn`, `isCancelled`, ...)

- **Pro:** Quick to add new flags without a state-machine migration.
- **Con:** 2^N legal-state explosion + every read site has to encode the
  rules ("if isPaid && !isCancelled && hasQr ...") which is exactly the
  bug pattern we're fixing.
- **Why rejected:** The four UX incoherences that motivated this ADR all
  boil down to UI surfaces guessing the rules from disparate flags.

### Alt C — Eventually consistent (Registration auto-derives from Payment via listener)

- **Pro:** No coupled transaction; listener handles the mirror.
- **Con:** Two writes, two failure modes; participant sees `pending_payment`
  for an indeterminate window after the IPN succeeds, which destroys the
  perceived correctness of the post-payment redirect.
- **Why rejected:** The IPN handler is already a single Firestore
  transaction — there is no cost reason to split it.

### Alt D — Surface a single `effectiveStatus` derived field

- **Pro:** UI reads one field, no client-side rules.
- **Con:** Either we denormalize on every Payment write (correctness depends
  on every code path remembering to update) or we compute on read (every
  list endpoint pays the join). Also: domain events lose precision because
  `effectiveStatus` is a UI concern, not a domain concern.
- **Why rejected:** The mirror table in the Decision section already gives
  us what `effectiveStatus` would, without inventing a new field. The UI
  switches on `Registration.status` directly because the mirror table
  guarantees it is always in sync.

---

## Consequences

### Positive

- A new payment-related UI surface adds zero net rules: it consumes the
  matrix and renders the row that matches `Registration.status`.
- The cron timeout, the IPN handler, and the user-abandon flow all share
  the same audit-event vocabulary (`payment.expired`,
  `registration.cancelled`), so the audit log + Datadog dashboards
  show the three failure modes side-by-side.
- The denormalized `paymentId` on Registration removes a Firestore read
  from the resume-payment flow (one fewer hop on the mobile-network-bound
  African user).
- The `getMyRegistrationForEvent` endpoint is a single index lookup
  (`registrations` collection has a composite index on
  `[eventId, userId, createdAt desc]`) so the hydration cost on the
  public event-detail CTA is bounded.

### Negative / accepted trade-offs

- Two writes per IPN (Payment + Registration) inside one transaction —
  marginally heavier than a single write, but bounded by the size of
  the registration document.
- The mirror table must be enforced by code review + the
  `firestore-transaction-auditor` and `domain-event-auditor` agents —
  there is no way to enforce it at the Firestore-rules level because
  rules can't see "is this happening inside the right tx".
- The 7-state Registration enum is wider than the 4-state shape we'd
  have without paid tickets — every new UI surface has to handle all
  seven (or explicitly skip cases). The `ExistingRegistrationView`
  component is the canonical reference for the full matrix.

### Follow-ups required

- [x] `paymentId` denormalized on Registration — `event.types.ts:RegistrationSchema`.
- [x] `cancelPending` service method + route — `registration.service.ts:cancelPending`, `registrations.routes.ts`.
- [x] `resumePayment` service method + route — `payment.service.ts:resumePayment`, `payments.routes.ts`.
- [x] `payment.expired` domain event + audit listener — `events/domain-events.ts`, `events/listeners/audit.listener.ts`.
- [x] `onPaymentTimeout` cron rewritten to flip Registration → cancelled in the same job.
- [x] `<ExistingRegistrationView>` covers all 7 states in `apps/web-participant/.../register/[eventId]/`.
- [x] `<EventRegisterCta>` adapts the public event-detail CTA per state.
- [x] `my-events` list gates badge action on `confirmed | checked_in` and exposes resume + abandon for `pending_payment`.
- [x] Badge route refuses to render outside `{confirmed, checked_in}`.
- [ ] Add a smoke test that walks the full happy path against PayDunya sandbox + the abandon path against the real `cancelPending` endpoint — owner: Platform team.
- [ ] Add a Datadog SLO on `pending_payment > 1h` count — owner: SRE.

---

## References

- `apps/api/src/services/registration.service.ts` — `getMyRegistrationForEvent`, `cancelPending` implementations.
- `apps/api/src/services/payment.service.ts` — `initiatePayment`, `onIpn`, `resumePayment`.
- `apps/api/src/events/domain-events.ts` — `PaymentExpiredEvent`.
- `apps/functions/src/triggers/payment.triggers.ts` — `onPaymentTimeout` cron.
- `apps/web-participant/src/app/(authenticated)/register/[eventId]/existing-registration-view.tsx` — UI matrix.
- `apps/web-participant/src/app/(public)/events/[slug]/event-register-cta.tsx` — public CTA hydration.
- `apps/web-participant/src/app/(authenticated)/my-events/page.tsx` — list view + actions.
- `apps/web-participant/src/app/(authenticated)/my-events/[registrationId]/badge/page.tsx` — defense-in-depth gate.
- `docs/badge-journey-review-2026-04-20.md` — full credential journey + sequencing.
- `docs/audit-2026-04-25/REPORT.md` §UX-Incoherences — original P0-blocker write-up.
- ADR-0010 — Domain event bus (the substrate this ADR builds on).
