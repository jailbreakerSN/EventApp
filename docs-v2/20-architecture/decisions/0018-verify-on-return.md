# ADR-0018: Verify-on-return as IPN-fallback finalisation path

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Platform team

---

## Context

Wave 6 ships paid tickets behind PayDunya hosted-checkout. The state-machine
contract from [ADR-0017](./0017-registration-payment-state-machine.md) names the
provider's IPN webhook as the **single canonical path** that finalises a paid
Payment (state flip + Registration confirm + counter increment + ledger entries).

The 2026-04-26 staging incident (`POST 400 6ms GuzzleHttp/PHP/5.6.40`) exposed
two failure modes that ADR-0017 didn't fully account for:

1. **Body-format drift** — PayDunya posts the IPN as PHP-style nested form
   encoding (`data[hash]=…&data[invoice][token]=…`) but our parser was
   variant-1 (`data=<json>`) only. The IPN landed but was rejected at parse
   time. Closed by [#202](https://github.com/jailbreakerSN/EventApp/pull/202).
2. **Provider IPN unreliability** — even with a correct parser, PayDunya
   sandbox is empirically flaky on IPN delivery. Operator anecdote from the
   integration testing window: ~15 % of sandbox transactions complete on the
   PayDunya side (visible in their "données fictives" dashboard) without ever
   hitting our `callback_url`. Live mode is reportedly more reliable but no
   provider in WAEMU advertises a 100 % delivery SLA.

Without a fallback, every missed IPN leaves the participant's Payment in
`processing` until the [`onPaymentTimeout` cron](../../apps/functions/src/triggers/payment.triggers.ts)
sweeps it 30 min later — flipping it to `expired`. The participant sees a
loading spinner during the entire window with no agency, and has paid for a
ticket that the system marks as cancelled. Customer-success burden is
predictable: every flaky IPN turns into a refund request.

The industry-standard parade is [Stripe's `paymentIntents.confirm` after
3DS-redirect](https://docs.stripe.com/payments/paymentintents/lifecycle#paymentintent-confirm),
[Adyen's `/payments/details` after redirect](https://docs.adyen.com/online-payments/build-your-integration/),
and PayPal's `/v2/checkout/orders/{id}/capture` after returnUrl: the
provider's `verify` endpoint is queried server-to-server when the participant
lands back from the hosted checkout, and the local Payment state is
synchronised regardless of whether the IPN ever fires.

This ADR formalises that pattern for Teranga.

---

## Decision

> **We will treat the participant's redirect-back to `/payment-status` as a
> trigger to call `provider.verify()` server-side and finalise the Payment
> with the same state-machine flip the IPN webhook would have done. The IPN
> remains the canonical fast path; verify-on-return is the deterministic
> fallback.**

Concrete shape:

- **Endpoint:** `POST /v1/payments/:paymentId/verify` (auth + permission
  `payment:read_own` + per-route rate-limit 20/min/user). Owner-only at the
  service layer — even `payment:read_all` admins cannot trigger a verify on
  someone else's Payment because verify has the side-effect of flipping the
  state.
- **Service method:** `paymentService.verifyAndFinalize(paymentId, user)` —
  short-circuits on terminal status (no provider call), reads the Payment's
  stored `providerTransactionId`, calls `provider.verify(...)`, runs the
  same transaction as the IPN webhook on terminal outcomes (Payment update +
  Registration confirm + Event counter increment + 2 ledger entries +
  `payment.succeeded` / `payment.failed` emit). All inside one
  `db.runTransaction(...)` with the same idempotency guard as
  `handleWebhook`.
- **Audit:** every verify call (regardless of outcome) emits
  `payment.verified_from_redirect` with `outcome: "succeeded" | "failed" |
  "pending"` so operators can size the IPN-reliability gap from the audit
  log.
- **Frontend:** the `/payment-status` page fires the verify on mount via
  `useVerifyPayment` (React Query mutation). On `succeeded` / `failed` the
  state-machine flip is reflected ≤ 1 s after redirect-back. On `pending`
  the page falls back to the existing 3 s polling loop on `/status`. A
  manual "Vérifier maintenant" button re-triggers the verify when polling
  has been inconclusive for too long.
- **No double-finalisation:** verify and IPN can race. The shared idempotency
  guard inside the transaction (`if status === "succeeded" return`) means
  whichever wins, the other becomes a no-op — no double-counter increment,
  no double-ledger entry, no double-emit of `payment.succeeded`.

---

## Sequence diagrams

### Happy path — IPN wins the race

```
Participant         Frontend            API                Provider
    │                  │                  │                   │
    │ pay on hosted    │                  │                   │
    │ checkout         │                  │                   │
    │ ───────────────────────────────────────────────────────►│
    │                  │                  │   IPN POST        │
    │                  │                  │ ◄─────────────────│
    │                  │                  │ tx: Payment ✓     │
    │                  │                  │ tx: Reg ✓         │
    │                  │                  │ emit succeeded    │
    │ redirect-back    │                  │                   │
    │ ───────────────► │                  │                   │
    │                  │ POST /verify     │                   │
    │                  │ ────────────────►│                   │
    │                  │                  │ already terminal  │
    │                  │                  │ — short-circuit   │
    │                  │ outcome: succeeded                   │
    │                  │ ◄────────────────│                   │
    │                  │ render badge     │                   │
```

### Verify wins the race (IPN never fires)

```
Participant         Frontend            API                Provider
    │ pay on hosted    │                  │                   │
    │ checkout         │                  │                   │
    │ ───────────────────────────────────────────────────────►│
    │                  │                  │   (no IPN — sandbox flake)
    │ redirect-back    │                  │                   │
    │ ───────────────► │                  │                   │
    │                  │ POST /verify     │                   │
    │                  │ ────────────────►│                   │
    │                  │                  │ verify(token)     │
    │                  │                  │ ────────────────► │
    │                  │                  │ status: succeeded │
    │                  │                  │ ◄──────────────── │
    │                  │                  │ tx: Payment ✓     │
    │                  │                  │ tx: Reg ✓         │
    │                  │                  │ emit succeeded    │
    │                  │ outcome: succeeded                   │
    │                  │ ◄────────────────│                   │
    │                  │ render badge     │                   │
    │                  │                  │   IPN POST (late) │
    │                  │                  │ ◄─────────────────│
    │                  │                  │ tx idempotent     │
    │                  │                  │ no-op             │
```

### Both still pending (rare — provider crashed mid-flow)

```
Participant         Frontend            API                Provider
    │ redirect-back    │                  │                   │
    │ ───────────────► │                  │                   │
    │                  │ POST /verify     │                   │
    │                  │ ────────────────►│                   │
    │                  │                  │ verify(token)     │
    │                  │                  │ ────────────────► │
    │                  │                  │ status: pending   │
    │                  │                  │ ◄──────────────── │
    │                  │                  │ NO state flip     │
    │                  │                  │ emit verified outcome=pending
    │                  │ outcome: pending │                   │
    │                  │ ◄────────────────│                   │
    │                  │ poll /status every 3 s               │
    │                  │ (until IPN OR onPaymentTimeout cron) │
```

---

## Reasons

| Concern | Verify-on-return (chosen) | Pure-IPN (status quo) | Long-poll on /status |
|---|---|---|---|
| UX after redirect-back | Confirmation in ≤1 s on the happy path. | Spinner for 0–30 s waiting on the IPN. | Spinner for 0–30 s, plus our infra burns CPU on the long-held connection. |
| IPN-failure recovery | Self-healing: every redirect-back doubles as a finalisation trigger. | None. The participant pays, sees a frozen page, contacts support. | None — the Payment never flips because no provider call happens. |
| Provider quota | Bounded by the page mount rate (≤ 1 verify per landing) plus rate-limit. | 0 (provider initiates). | 0. |
| Idempotency | Inner-tx guard makes IPN-and-verify races safe by construction. | The single canonical path is naturally idempotent against IPN retries. | n/a — no state mutation. |
| Audit clarity | `payment.verified_from_redirect` event lets ops size the IPN-reliability gap. | We can only see "IPN landed" — silently-missed IPNs are invisible. | n/a. |
| Implementation cost | One service method (~150 LOC, mirrors handleWebhook), one route, one frontend hook, one ADR. | Free — already shipped. | Significant — long-poll requires Cloud Run min-instances tuning + connection-budget rework. |

---

## Alternatives considered

### Alt A — Pure-IPN (status quo)

- **Pro:** Simplest model. No client-driven mutation surface; the provider is the only writer.
- **Con:** Hostage to provider IPN reliability. PayDunya sandbox empirically loses ~15 % of IPNs; production is reportedly better but no provider in WAEMU advertises a 100 % SLA. Customer-success bears every loss as a refund request.
- **Why rejected:** Doesn't recover from a missed IPN. The user-visible failure mode is "I paid and the system says I haven't" — the worst possible UX for a paid product.

### Alt B — Long-poll on /status

- **Pro:** No new endpoint; reuses the existing polling surface.
- **Con:** Doesn't change the underlying state-mutation path — the Payment still only flips when the IPN lands. The participant's perceived UX improves marginally but the actual reliability problem stays. Also: long-poll requires Cloud Run `--min-instances ≥ 1` to avoid cold-start drops on the held connection, which doubles our staging cost.
- **Why rejected:** Doesn't fix the root problem (missed IPNs).

### Alt C — Frontend-only optimistic UI

- **Pro:** Zero backend change.
- **Con:** Lying to the user. The frontend would render "succeeded" before the backend has any signal — if the IPN never fires, the badge in `/my-events` lists a registration that doesn't actually exist server-side. Refresh the page → confusion.
- **Why rejected:** Optimistic UI is fine for low-stakes mutations; not for paid registrations.

### Alt D — Server-side reconciliation cron only (no per-request verify)

- **Pro:** No new request path; recovers missed IPNs eventually via a daily cron.
- **Con:** "Eventually" = up to 24 h. The participant who paid 2 minutes ago and refreshed `/payment-status` sees the same loading spinner. Phase 3 reconciliation (this sprint) covers the long-tail of stuck payments but NOT the immediate redirect-back UX.
- **Why rejected:** Solves the wrong problem on the wrong horizon. Verify-on-return + reconciliation cron are complementary — verify covers the per-redirect immediate path, reconciliation covers stragglers (e.g. participant closed the tab before redirect-back).

---

## Consequences

### Positive

- Median time-to-finalisation post-redirect drops from "wait for IPN" (variable, 0–30 s in the happy case, ∞ in the missed-IPN case) to ≤ 1 s deterministic.
- The IPN-reliability gap becomes measurable (`payment.verified_from_redirect` event count vs `payment.succeeded` from IPN) — operators can size the problem and decide whether to escalate to PayDunya.
- The participant has agency via the manual "Vérifier maintenant" button when the auto-verify is inconclusive.
- The state-machine contract from ADR-0017 stays intact — verify-on-return uses the same transaction shape, the same domain events, the same audit rows. The only added concept is the `payment.verified_from_redirect` event which is purely audit-facing.

### Negative / accepted trade-offs

- One extra outbound provider call per redirect-back. Mitigated by the terminal-status short-circuit (already-terminal payments don't pay the call) and per-route rate-limit (20/min/user). Worst case under attack: 20 verify calls/min/user × $0.001 PayDunya fee = $1.20/h/user — acceptable.
- A second writer to the Payment finalisation transaction. Mitigated by the inner-tx idempotency guard (`if status === "succeeded" return`). Tested via the `noops the tx when an IPN flipped Payment to succeeded between the outer read and the inner-tx read` case.
- The frontend now has TWO paths into the same state-machine flip (verify mutation + polling on `/status`). Slight UX-state machine complexity; the page distinguishes via `verifyOutcome` ∈ `idle | verifying | succeeded | failed | pending | error` so the loader copy adapts.

### Follow-ups required

- [x] Service method `verifyAndFinalize(paymentId, user)` — `apps/api/src/services/payment.service.ts`.
- [x] Route `POST /v1/payments/:paymentId/verify` — `apps/api/src/routes/payments.routes.ts`.
- [x] Domain event `payment.verified_from_redirect` + audit handler — `apps/api/src/events/{domain-events,listeners/audit.listener}.ts`.
- [x] Frontend hook `useVerifyPayment` + `/payment-status` page integration + i18n FR/EN/WO.
- [ ] Phase-2 follow-up — collapse the duplicated transaction logic in `verifyAndFinalize` and `handleWebhook` into a shared private helper. Skipped in v1 to minimise regression risk on the most-exercised financial path.
- [ ] Phase 3 daily reconciliation cron (`payments-reconciliation.cron.ts`) covers the stragglers where the participant closed the tab before redirect-back AND the IPN didn't fire. Tracked in the same PR as this ADR.
- [ ] Datadog dashboard tile: `payment.verified_from_redirect{outcome:succeeded}` rate vs `payment.succeeded{source:ipn}` rate over 7 d to size the IPN-reliability gap.

---

## References

- [ADR-0017](./0017-registration-payment-state-machine.md) — the state-machine contract this ADR extends.
- `apps/api/src/services/payment.service.ts` — `verifyAndFinalize` implementation.
- `apps/api/src/routes/payments.routes.ts` — `POST /v1/payments/:paymentId/verify` route.
- `apps/api/src/events/listeners/audit.listener.ts` — `payment.verified_from_redirect` audit handler.
- `apps/web-participant/src/hooks/use-payments.ts` — `useVerifyPayment` React Query hook.
- `apps/web-participant/src/app/(authenticated)/register/[eventId]/payment-status/page.tsx` — UI integration.
- [Stripe — `paymentIntents.confirm` after redirect](https://docs.stripe.com/payments/paymentintents/lifecycle).
- [Adyen — `/payments/details` after redirect](https://docs.adyen.com/online-payments/build-your-integration/).
