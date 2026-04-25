---
title: Payment surface — Phase-0 readiness report
date: 2026-04-26
status: shipped
audience: maintainers, security reviewers, payment ops
sprint: Payments — Phase 0 (audit + threat model)
branch: claude/payments-phase-0-audit
---

# Payment surface — Phase-0 readiness report

> **Mission.** Produce an honest baseline of the existing payment surface BEFORE we extend it with PayDunya (aggregator), Wave + Orange Money via Teranga's single PayDunya merchant account, and SaaS subscription billing. The audit drives Phase 1's hardening backlog and locks the architectural decisions for Phases 2–6.

> **Method.** Three parallel deep-reviews (code-quality, security, atomicity) on the existing 2 085 LOC payment surface, plus an industry-state-of-the-art comparison and a STRIDE threat model. Read-only audit — no source code modified during Phase 0.

> **TL;DR.** Payment surface is **~70 % production-ready**. Core transactional safety is excellent (every state-flipping operation runs inside `db.runTransaction()`); webhook logging + dedup is sophisticated; ledger model is sound. **Three critical gaps + four high-severity defects must close before PayDunya integration.** Estimated Phase-1 hardening: 1 week.
>
> **Top three blockers:**
>
> 1. **No idempotency-key on payment creation** — a network retry creates duplicate payments. Trivial to exploit accidentally; fix is &lt;4h.
> 2. **`createPayout()` race condition** — two concurrent payout sweeps on the same `(org, event, period)` produce two `Payout` docs and two debit ledger entries totalling `2 × netAmount`. **Money-loss bug.** Fix is a `tx.create()` lock sentinel.
> 3. **`providerMetadata` PII leak** — Wave / Orange Money webhook payloads (customer phone, internal session IDs, `notif_token` shared secret) are returned verbatim to participants via `GET /v1/payments/:id/status`. GDPR + spoofing risk if `notif_token` ever reaches the response.
>
> Full inventory: §2. Phase 1 hardening backlog: §6.

---

## 0 · Locked architectural decisions

These are the answers we picked for the 6 open questions surfaced in the initial brainstorm. They are **not** revisited in Phases 1–6 unless a Phase-N finding contradicts the rationale.

| # | Decision | Rationale (1-line) |
|---|---|---|
| **D1** | Aggregator-first via **PayDunya**, swappable to direct providers via the existing `PaymentProvider` interface. | Senegal-native aggregator, FCFA-native, native Wave + OM, ~1.5% fee. Direct-swap stays a one-class change. |
| **D2** | **Both tickets + SaaS subscriptions**, designed together, shipped incrementally (tickets Phase 1-3, subscriptions Phase 4). | They share 80 % of primitives; designing for both prevents a re-architecture at month 6. |
| **D3** | **Platform-collected via a single Teranga PayDunya merchant account; scheduled payouts to organizers via the existing `payout.service.ts`.** Customer pays → funds land in Teranga's PayDunya → batched payout to the organizer's Wave / OM / bank account on Teranga's payout schedule. | Onboarding friction is the killer in WAEMU markets — per-org PayDunya KYC blocks adoption. Same pattern as Eventbrite, Festicket, Yengo. Teranga becomes merchant of record (compliance burden manageable at our scale; BCEAO regulates the mobile-money operators themselves, not platforms reselling tickets paid via those rails). Existing `payout.service.ts` already implements the org-payout sweep. |
| **D4** | **Refund window:** until event start + 24 h grace. **Authority:** organizer-initiated by default; auto-refund on event cancellation; participant self-service deferred to Phase 6. | Industry standard for ticketing; self-service is fraud-prone without dispute mediation. |
| **D5** | **XOF-only v1**; EUR via Stripe added as a separate provider in a later phase. | Single-currency = no FX, no dual-pricing, no complex reporting. Multi-currency is a 1-week add. |
| **D6** | **Mobile-money push-payment first** (near-zero chargeback). Card dispute workflow deferred to the Stripe phase. | Match the actual risk profile of WAEMU mobile money. |

---

## 1 · State of the existing payment surface

### 1.1 Volume + shape

| File | LOC | Role |
|---|---|---|
| `apps/api/src/services/payment.service.ts` | 794 | Core service — init / verify / refund / status |
| `apps/api/src/services/payout.service.ts` | 210 | Payout sweeps + ledger debit |
| `apps/api/src/services/webhook-events.service.ts` | 384 | Webhook receipt + dedup + retry log |
| `apps/api/src/routes/payments.routes.ts` | 697 | HTTP layer + webhook router + mock-checkout dev surface |
| `apps/api/src/providers/payment-provider.interface.ts` | ~95 | Provider contract |
| `apps/api/src/providers/wave-payment.provider.ts` | ~155 | Wave HTTP client + HMAC verify |
| `apps/api/src/providers/orange-money-payment.provider.ts` | ~180 | OM OAuth + token verify |
| `apps/api/src/providers/mock-payment.provider.ts` | ~130 | Dev / test provider |
| `packages/shared-types/src/payment.types.ts` | ~95 | `PaymentSchema` + DTOs |
| `packages/shared-types/src/balance-transaction.types.ts` | ~110 | Ledger schema |

**Total:** ~2 850 LOC across services, providers, shared types. Substantial pre-existing surface; this is a **harden + extend** project, not a greenfield build.

### 1.2 `PaymentStatus` state machine (verified from code)

```
                       ┌─→ succeeded ─┬─→ refunded
pending ─→ processing ─┤              └─ (terminal)
                       ├─→ failed ─── (terminal)
                       └─→ expired (DEFINED IN SCHEMA, NEVER ASSIGNED — orphan status)
```

| Transition | File:line | Inside `db.runTransaction()` ? |
|---|---|---|
| `pending → processing` | `payment.service.ts:279` (`initiatePayment`) | ✅ |
| `processing → succeeded` | `payment.service.ts:368` (webhook success path) | ✅ + writes 2 `BalanceTransaction` rows + counter increments + registration confirm — all atomic |
| `processing → failed` | `payment.service.ts:472` (webhook failure path) | ✅ + registration cancel — atomic |
| `succeeded → refunded` | `payment.service.ts:705` (full-refund path) | ✅ + writes negative `BalanceTransaction` + counter decrement + registration cancel — atomic |
| `succeeded → succeeded` (partial refund) | `payment.service.ts:705` | ✅ — `refundedAmount` increments, `status` stays `succeeded` |

**Findings:**

1. **`expired` status is dead code** — defined in `payment.types.ts:11`, never assigned by any service path. Either implement a stale-payment cleanup job (Phase 4 candidate) or remove from the schema. Currently confuses operators.
2. **`succeeded → succeeded` partial-refund pattern is correct** but visually ambiguous. Phase-4 candidate: add a `partially_refunded` status for clarity in dashboards.
3. **No regressive transitions are reachable from any code path.** ✅

### 1.3 Provider abstraction quality

The `PaymentProvider` interface (`payment-provider.interface.ts`) is **clean and PayDunya-ready**:

- `initiate()` / `verify()` / `refund()` / `verifyWebhook()` cover the full lifecycle.
- Wave + OM + Mock implementations conform without service-layer branching.
- Sketched a `PayDunyaPaymentProvider` against the interface — would work without modifying the service layer. Just register in the `providers` map at `payment.service.ts:47-65` and add to the webhook router at `payments.routes.ts:229-246`.

**Three minor leaky abstractions** (acceptable for now, document in Phase-2):

1. Service registry hardcodes provider names by `PaymentMethod` string (`payment.service.ts:47-65`). PayDunya needs `card: paydunyaProvider`, but adding it requires touching the registry.
2. Webhook route branches on provider name (`payments.routes.ts:229`). Intentional (each provider has its own signature scheme); acceptable.
3. `RefundResult.reason` is a closed enum (`"manual_refund_required" | "provider_error"`). New providers may need new reasons.

### 1.4 Dead / unused code

- `PaymentStatusSchema` includes `"expired"` — never assigned (see 1.2 above).
- All other code is wired and referenced. Wave + OM providers are both **conditionally registered** based on env vars (`payment.service.ts:44-50`) — if their secret env vars are unset, they don't load. This is intentional dev-friendliness, not dead code.

### 1.5 State-of-the-art comparison (Stripe / Adyen / Wise)

| Aspect | Stripe | Adyen | Wise | **Teranga** |
|---|---|---|---|---|
| Idempotency key on creation | ✅ (24h cache) | ✅ (merchant ref) | ✅ | ❌ — see Critical-1 |
| Webhook dedupe | Event ID + checksum | Merchant reference | Payment ref | Composite (provider + txId + status) ✅ |
| Ledger model | Atomic `balance_transactions` | Modeled via splits | Per-transfer | ✅ — `BalanceTransaction` with status/availableOn |
| Refund concurrency | Idempotent refund ID | Merchant refund ref | Idempotency key | Lock-based (`refundLocks`) ✅ |
| PII handling | Tokenized; raw card never persisted | Tokenized | Reference IDs only | ❌ — raw provider metadata persisted (Critical-3) |
| Multi-currency | Auto conversion + settlement | Multi-market | In-scope (no FX) | XOF-only (intentional v1) |
| Dispute / chargeback | Webhooks + reserves | Debit + reversal entries | n/a (transfer-only) | ❌ — no model (acceptable for mobile-money-first) |

**Verdict:** Teranga's ledger model is actually **more explicit** than Stripe's `available` balance summary — it's event-sourced, which is a strict improvement for auditability. The two genuine industry-standard gaps are idempotency-on-creation and PII-redaction-before-response. Both are fixed in Phase 1.

---

## 2 · Defects inventory (ranked)

> Cross-cutting findings reported once with the agent that flagged them in parentheses (CR = code-review, SEC = security, TX = transaction-safety). Bold severity = blocks Phase-2 PayDunya integration. Each finding ships with a concrete fix sketch tested against the existing patterns in `event.service.ts` / `registration.service.ts`.

### Critical (BLOCKS Phase-2 PayDunya integration)

#### **C1 — No idempotency-key on `POST /v1/payments/initiate`** (CR)
**File:** `payment.service.ts:156-309` + `payments.routes.ts:156-169`
**Risk:** Network retry from the participant's mobile app creates **two** `pending` payments + two `processing` provider sessions. The in-transaction duplicate check at `payment.service.ts:240-249` only catches duplicates within the same Firestore transaction — it does not dedupe across separate HTTP calls.
**Fix:** Accept `Idempotency-Key` header. Compute `idempotencyKeyId = sha256(userId + eventId + ticketTypeId + method + headerKey)`. `tx.create()` a doc in `payment_idempotency_keys/{id}` at the top of the transaction; on `ALREADY_EXISTS` return the cached `paymentId` + 200 OK (or 409 with the same `paymentId`, depending on retry semantics). TTL 24 h.

#### **C2 — `createPayout()` race: two concurrent sweeps double-pay** (TX, SEC HIGH-5)
**File:** `payout.service.ts:61-170`
**Risk:** Two concurrent `createPayout()` calls on the same `(orgId, eventId, periodFrom, periodTo)` both pass the outer non-tx read at line 78, both enter their own transaction, both sweep the same `available` `BalanceTransaction` rows (the second's retry filters them out, but the second `Payout` doc is still created with the stale `netAmount`). Result: **two `Payout` docs + two debit ledger entries totalling `2 × netAmount`** — money loss.
**Fix:** Add a `tx.create()` sentinel at the top of the transaction:
```typescript
const lockKey = `${orgId}_${eventId}_${periodFrom}_${periodTo}`;
const lockRef = db.collection("payoutLocks").doc(lockKey);
await tx.create(lockRef, { createdAt: now, payoutId: payoutRef.id });
// .create() throws ALREADY_EXISTS on the second concurrent caller → tx aborts cleanly
```
The lock is permanent (one payout per period — semantically correct).

#### **C3 — `providerMetadata` PII leak on every payment-status read** (SEC CRIT-1)
**File:** `payment.service.ts:499-507` + `payments.routes.ts:398, 426`
**Risk:** `getPaymentStatus()` returns the full `Payment` doc — including `providerMetadata` — directly to the participant. Wave + OM populate `providerMetadata` verbatim from webhook responses, which include customer phone numbers, internal session IDs, operator routing codes. Violates GDPR + Senegalese consumer-protection norms.
**Fix:** Service projects to a `PaymentClientView` shape (no `providerMetadata`, no `callbackUrl`, no raw `redirectUrl` after redemption). A separate `GET /v1/admin/payments/:id?includeProviderMetadata=true` route, gated by `platform:manage`, exposes redacted metadata for support: phone masked to last 4 digits, OAuth tokens stripped, only `provider_payment_id` + `provider_status_code` retained.

#### **C4 — OM `notif_token` (shared webhook secret) shape exposes the secret to `providerMetadata` if a future code path serialises the full provider response** (SEC CRIT-2)
**File:** `orange-money-payment.provider.ts:97-107`
**Risk:** OM's `initiate()` response type declares `notif_token: string` — the **same pre-shared symmetric secret** used to authenticate every future OM webhook. The current code only stores `pay_token` as `providerTransactionId` and discards the rest, but the type definition is a footgun: any future log line / debug-dump / providerMetadata-spreader leaks the webhook-signing secret. Combined with C3, becomes a direct path to forged webhook acceptance.
**Fix:** In `initiate()`, explicitly `delete data.notif_token` before returning. Update the response type to omit it. Add a unit test that asserts `notif_token` is never in the returned object.

#### **C5 — Provider error body leaked verbatim in thrown `Error.message`** (SEC CRIT-3)
**File:** `wave-payment.provider.ts:48-49` + `orange-money-payment.provider.ts:93-94`
**Risk:** `throw new Error(\`Wave API error (${response.status}): ${body}\`)` where `body` is the raw provider response. Wave / OM error bodies contain card BINs, masked account numbers, OAuth diagnostic payloads. These bubble up to `payment.service.ts` exception handling and can surface in JSON error responses + Cloud Logging without sanitisation (the `sanitizeErrorMessage()` helper only fires in webhook-events context, not initiate/refund).
**Fix:** Providers throw a generic `ProviderError` carrying only the HTTP status code + a stable error code. Full body goes to `request.log.error({ providerBody: body })` via the Fastify logger only. API responses surface the stable code, never the body.

### High (must close before Phase-2 ships to staging)

#### **H1 — `paidTickets` plan feature gate missing at payment init** (CR Critical-4, SEC HIGH-1)
**File:** `payment.service.ts:156-309` (no plan check) vs `event.service.ts:993, 1047` (where the gate IS enforced)
**Risk:** A Free or Starter org that downgrades after creating a paid event (or an event seeded directly bypassing event-creation gates) can still collect real money — payment init has no `requirePlanFeature(org, "paidTickets")` call. Money-of-record enforcement must be at the payment layer, not (only) the event-creation layer.
**Fix:** In `initiatePayment()`, load the org doc, call `this.requirePlanFeature(org, "paidTickets")` BEFORE the provider call. Same pattern as `event.service.ts:993`.

#### **H2 — `provider.initiate()` called BEFORE the Firestore transaction → orphaned provider sessions on tx abort** (SEC HIGH-2)
**File:** `payment.service.ts:225-249`
**Risk:** Provider checkout session is created at line 227 (live HTTP call to Wave/OM). The Firestore transaction starts at line 238 and may abort (DuplicateRegistrationError, contention). The provider session is now **live with no local record** — anyone who guesses the `providerTransactionId` could complete a payment that maps to no participant.
**Fix:** Two-phase pattern — first transaction creates a `pending` `Payment` record with a placeholder `providerTransactionId: null`; provider call happens AFTER tx commit; second transaction updates the record with the real `providerTransactionId` once the session is confirmed. On second-tx failure, a reconciliation job (Phase 3) picks up orphan `pending` records and either confirms via `provider.verify()` or marks them `expired`.

#### **H3 — `eventBus.emit("payment.succeeded")` fires outside the transaction → duplicate notifications on concurrent webhook retries** (SEC HIGH-3)
**File:** `payment.service.ts:443`
**Risk:** Wave fires the same webhook 2-5 times within seconds. The in-tx idempotency guard at lines 348-353 correctly prevents the **ledger** from double-writing, but the `emit("payment.succeeded")` at line 443 fires on every webhook invocation that reaches that path. Listeners (notification dispatcher, audit writer) are not all idempotent — duplicate emails, duplicate audit rows, duplicate `registration.confirmed` cascades.
**Fix:** Capture a `wasNewlySucceeded: boolean` flag inside the transaction's success branch. After tx commit, only emit if `wasNewlySucceeded === true`. Pattern:
```typescript
const wasNewlySucceeded = await db.runTransaction(async (tx) => {
  // ... existing logic ...
  if (freshPayment.status === "succeeded") return false; // already done
  // ... do the work ...
  return true;
});
if (wasNewlySucceeded) eventBus.emit("payment.succeeded", { ... });
```

#### **H4 — Full refund decrements `event.registeredCount` but NOT `ticketTypes[].soldCount` → capacity counters drift** (CR Critical-7)
**File:** `payment.service.ts:710-721`
**Risk:** Full refund cancels the registration + decrements `event.registeredCount`, but the per-ticket-type `soldCount` is never decremented. Over time `event.registeredCount` and `sum(ticketTypes[].soldCount)` diverge. The next registration attempt may fire a spurious `EventFullError` because the per-ticket-type counter is artificially inflated.
**Fix:** Inside the same refund transaction, find the registration's `ticketTypeId`, locate the index in `eventData.ticketTypes`, and decrement `ticketTypes[idx].soldCount` in the SAME `tx.update(eventRef, ...)` call as `registeredCount`.

#### **H5 — `ticketTypes[].soldCount` increment uses client-side `+1` rather than `FieldValue.increment()` → fragile pattern** (TX 🔴 #2)
**File:** `payment.service.ts:387-393`
**Risk:** The webhook success path builds `updatedTicketTypes` from `eventSnap.data().ticketTypes` (transactional read, safe within the tx) then does `tt.soldCount + 1`. Two `tx.update(eventRef, ...)` calls (lines 381 and 388) on the same ref — Firestore merges them, but the array-rewrite pattern is fragile vs. any future non-transactional path that touches `ticketTypes[]`.
**Fix:** Merge into one `tx.update()`. Document explicitly that `ticketTypes[].soldCount` MUST only ever be mutated inside transactions. Phase-3 candidate: model `ticketTypes` as a subcollection so `FieldValue.increment()` works on the doc.

#### **H6 — No IP allowlist on webhook endpoints** (SEC HIGH-4)
**File:** `payments.routes.ts:213-294`
**Risk:** Webhook endpoints rely entirely on HMAC verification. If `WAVE_API_SECRET` or `OM_NOTIF_TOKEN` ever leaks (via C5 or any future log misconfiguration), there's **no network-layer defence**. Wave + OM publish stable webhook origination CIDRs.
**Fix:** Per-provider `WAVE_WEBHOOK_IPS` / `OM_WEBHOOK_IPS` env vars (comma-separated CIDR list). Middleware checks `req.ip` against the allowlist BEFORE HMAC verify. Fail-open when the env var is unset (dev mode); fail-closed when set (production).

### Medium

#### **M1 — Concurrent refund lock released outside transaction** (CR High-5)
**File:** `payment.service.ts:602-754`
**Risk:** Refund lock is created pre-provider-call (line 605) and released inside the tx (line 754). Window between provider success and tx abort: a second concurrent refund could see the lock released (after tx rollback) and double-hit the provider.
**Fix:** Move the `lockRef.create()` inside the transaction; the inner `db.runTransaction()` retry semantics handle concurrent contention cleanly. Provider call still happens outside the tx (long network call), but the lock is held + released atomically.

#### **M2 — `createPayout()` reads payment amounts outside the tx → stale `netAmount` if a refund races** (SEC HIGH-5, TX commentary)
**File:** `payout.service.ts:72-88` vs `113-170`
**Risk:** `filtered` payments computed at line 78 (outside tx). If a refund completes between line 88 and the transaction start, the payout's `netAmount` is computed from the pre-refund payment.amount. Window is narrow but real.
**Fix:** Re-read payment amounts inside the tx (or query `balanceTransactions` for the net balance inside the tx and use THAT figure as the source of truth — it's more robust because it reflects post-refund reality by definition).

#### **M3 — `providerMetadata` not redacted on the per-event summary endpoint** (CR Medium-10, SEC CRIT-1 cross-cut)
**File:** `payment.service.ts:547-555` (`getEventPaymentSummary`)
**Risk:** Same PII leak as C3, secondary surface — organizer dashboard summary may include raw provider metadata in the per-payment array if the summary type doesn't exclude it. **Verify exact projection.**
**Fix:** Same projection as C3 — strip `providerMetadata` at the service boundary.

#### **M4 — `refund.issued` domain event uses stale outer-snapshot fields** (SEC MED-3)
**File:** `payment.service.ts:778-789`
**Risk:** Audit trail discipline — events should be attributed from the transactional re-read (`freshPayment`), not the outer non-tx read. The fields are immutable in practice (registrationId / eventId / organizationId never change), but the pattern violates the audit-row-from-tx-state convention.
**Fix:** Capture `freshPayment.{registrationId, eventId, organizationId}` from inside the tx, pass via a captured variable, use those for both `payment.refunded` and `refund.issued` emits.

#### **M5 — `limit: 10000` Firestore queries in payout calc + sweep paths** (SEC MED-2)
**File:** `payment.service.ts:535`, `payout.service.ts:37, 75`
**Risk:** Enterprise-tier event with tens of thousands of payments → unbounded Firestore read units + memory. Concurrent payout creation doubles the cost.
**Fix:** Use Firestore `aggregate()` for sums + counts where possible. Cursor-based pagination + streaming accumulator for the payout sweep.

#### **M6 — Mock-checkout `/complete` route lacks Zod validation** (SEC MED-1)
**File:** `payments.routes.ts:676-695`
**Risk:** Dev/staging only, but staging shares the code path with the mock provider fallback. An attacker on staging with a known `txId` can send any body and `simulateCallback` runs.
**Fix:** Add `validate({ params: z.object({ txId: z.string().min(1).max(128) }), body: z.object({ success: z.boolean() }) })` to the `preHandler` array.

#### **M7 — Wave refund returns empty `RefundResult` on error (no `reason`)** (CR Medium-8)
**File:** `wave-payment.provider.ts:91-111`
**Risk:** Service treats `success: false` without `reason` as generic provider error — operator sees an unhelpful "provider refused" message instead of an actionable code (network timeout, insufficient funds, manual-refund-required).
**Fix:** Detect Wave error codes from the response body, map to the discriminated union (`reason: "provider_error" | "manual_refund_required" | "insufficient_funds" | "network_timeout"`). Extend `RefundResult.reason` enum to cover the new cases.

#### **M8 — OM OAuth token cache is not request-coalesced** (CR Medium-9)
**File:** `orange-money-payment.provider.ts:36-65`
**Risk:** Two concurrent `initiate()` calls racing on token expiry both fetch new tokens — wastes auth API quota. Not a fund-loss risk.
**Fix:** Promise-based memoization: store `tokenPromise` not `token`, so concurrent callers await the same in-flight request.

### Low / Nit

#### **L1 — `expired` status defined but never assigned** (CR Low + 1.2)
**File:** `payment.types.ts:11`
**Fix:** Either implement a stale-payment cleanup job (Phase 3-4) OR remove from the schema. Currently confuses operators reading the enum.

#### **L2 — Wave provider doesn't distinguish 401/403 (wrong key) from 422 (validation)** (SEC LOW-1)
**File:** `wave-payment.provider.ts:47-49`
**Fix:** Map HTTP status to a typed error code so misconfiguration looks different from a transient API issue.

#### **L3 — `WAVE_API_SECRET` falls back to empty string at module load** (SEC LOW-2)
**File:** `wave-payment.provider.ts:25`
**Fix:** Startup assertion: if `WAVE_API_KEY` is set but `WAVE_API_SECRET` isn't, throw at boot. Currently silently rejects every Wave webhook.

#### **L4 — `CalculateQuery.periodFrom/periodTo` accept any string (no ISO 8601 check)** (SEC LOW-3)
**File:** `payouts.routes.ts:13-16`
**Fix:** `z.string().datetime()` (now available via the shared `IsoDateTimeSchema` shipped in PR #191).

### Test coverage gaps (top 5 to add before Phase 2)

1. **Concurrent webhook delivery with identical `providerTransactionId`** — assert exactly one ledger pair, exactly one `payment.succeeded` emit (currently leaks per H3).
2. **Refund amount math boundaries** — 0 XOF (reject), 1 XOF of 10 000 (succeed, status stays `succeeded`), 10 000 of 10 000 (succeed, status flips to `refunded`), 10 001 of 10 000 (reject).
3. **Webhook signature edge cases** — empty header, wrong-length signature, mutated body. Existing tests mock `verifyWebhook` rather than exercising the actual HMAC.
4. **Refund concurrent lock semantics** — two simultaneous refund calls; assert exactly one provider call + 409 to the loser.
5. **Cross-org IDOR on payment read** — Org-A admin reads `GET /v1/payments/:org-b-payment-id/status`; assert 403.

---

## 3 · STRIDE threat model

For each threat we identify the attack surface in the payment subsystem, the existing mitigation (if any), and the residual gap. Every gap maps to a defect in §2 OR a Phase-1 task in §6.

### 3.1 — Spoofing (forged webhook)

**Surface.** `POST /v1/payments/webhook/:provider` accepts unauthenticated POST requests from the public internet — providers can't carry a Firebase ID token. Attacker forges a webhook claiming a payment succeeded → we credit a registration that was never paid for.

**Mitigations required.**

- HMAC-SHA256 signature verification on every provider's payload, with **constant-time** comparison (`crypto.timingSafeEqual`).
- The raw request body is preserved and used as the HMAC input — **never** Fastify's reparsed JSON (formatting differs → signature mismatches).
- IP allowlist per provider (PayDunya, Wave, OM publish their callback IP ranges; we validate `req.ip` against the allowlist before HMAC verify so a flood from outside the allowlist short-circuits at L4).
- Webhook endpoints **never** carry the `authenticate` middleware (would erroneously demand a Firebase token).

**Status.** Provider interface defines `verifyWebhook(rawBody, headers): boolean`. Coverage of the four points above is verified by the security audit (§2).

**Per D3 (platform-collected):** ONE webhook URL serves all orgs (`POST /v1/payments/webhook/paydunya`) with ONE Teranga-owned HMAC secret. Org dispatch happens by `providerTransactionId` lookup → `Payment.organizationId`. No org-namespaced webhooks needed (no per-org PayDunya account = no per-org HMAC secret to rotate). This drops the previously-considered H7 "org-namespaced webhook" hardening task: it would only have been required under the org-direct split-payment model we rejected.

### 3.2 — Tampering (modify amount mid-flight)

**Surface.** `POST /v1/payments` accepts a request body. If `amount` is in the body, an attacker can pay 100 XOF for a 25 000 XOF VIP ticket.

**Mitigations required.**

- The `amount` is **always** server-computed from `eventId` + `ticketTypeId`. Client passes the ticket selection only. Zod schema for `InitiatePaymentSchema` MUST omit any client-controllable amount field.
- Refund amount is server-validated against the original payment's `amount - refundedAmount` — never trust a client-supplied refund amount.

**Status.** Verified by the code audit.

### 3.3 — Repudiation ("I didn't authorize this refund")

**Surface.** Any state-changing action on a payment must be traceable to a specific actor for chargeback / dispute defence.

**Mitigations required.**

- Domain-event emission on **every** transition (`payment.initiated`, `.processing`, `.succeeded`, `.failed`, `.expired`, `.refunded`, `.disputed`, `.reconciled`). The audit listener already writes to `auditLogs` from any event we emit.
- The audit row carries: actor uid, request id, IP (real client IP via `trustProxy`), user-agent, the before/after status, the event/registration ids, the provider transaction id, the amount delta.
- Webhook-driven transitions get an actor uid of `system:webhook:<provider>` — distinguishable from human actions.

### 3.4 — Information disclosure (PII / token leaks via `providerMetadata`)

**Surface.** `providerMetadata` is a free-form `Record<string, unknown>` returned to the client on `GET /v1/payments/:id`. PayDunya's webhook payload contains the customer's phone number, sometimes their email, and an internal `customer_token` we should never relay.

**Mitigations required.**

- Service layer strips `providerMetadata` from API responses by default. Only super-admin / org-owner can opt into a `?includeProviderMetadata=true` query param.
- The opted-in payload is **redacted** server-side: phone number masked to last 4 digits, customer_token stripped, only the `provider_payment_id` + `provider_status_code` exposed.

### 3.5 — Denial of service

**Surface.** Payment-init endpoint flood (drain provider quota); webhook endpoint flood (overwhelm processing).

**Mitigations required.**

- Composite-key rate limit (shipped via PR #192): `user:*` 120/min, `apikey:*` 600/min, `ip:*` 30/min.
- Per-route stricter override on `POST /v1/payments`: 10/min per user (matches the realistic ticket-buying cadence).
- Webhook endpoint exempt from the global limit but capped at 1000/min per provider IP via a separate route-level config.

### 3.6 — Elevation of privilege (cross-org IDOR)

**Surface.** `GET /v1/payments/:id` / `GET /v1/payouts/:id` / refund endpoint — without org-scoping, org A could read or refund org B's payments.

**Mitigations required.**

- `requireOrganizationAccess()` on every read AND every write in the payment service.
- `requirePermission()` on every mutation — `payment:refund`, `payout:initiate`, `payment:read`.
- Firestore rules deny **all** client writes to `payments` / `payouts` / `balanceTransactions` / `subscriptions`. API server is the only writer.

### 3.7 — Replay (re-submit succeeded webhook to flip status backwards or double-credit)

**Surface.** Mobile money providers fire the same webhook 2–5 times within seconds. If we naively flip `Payment.status = succeeded` on every receipt, we credit the registration multiple times AND write multiple `BalanceTransaction` rows.

**Mitigations required.**

- `providerTransactionId` is **unique-indexed** in Firestore (or enforced by a transaction that reads-then-rejects-on-existing).
- The webhook handler runs inside `db.runTransaction()`: read by `providerTransactionId`, if exists with same status → 200 OK no-op; otherwise flip status + write ledger row + commit.
- State machine **rejects regressive transitions** at the service layer: `succeeded → pending` is a 409 Conflict, not a silent overwrite.

### 3.8 — Race conditions (concurrent webhook + manual status check)

**Surface.** Operator clicks "Verify status" at the same moment a webhook fires. Two simultaneous reads of `Payment.status === pending`, two simultaneous flips to `succeeded`, two `BalanceTransaction` rows.

**Mitigations required.**

- Every status flip is inside `db.runTransaction()`. The transaction reads the current status, asserts the expected source state, writes the target state + ledger row + counter increment **in the same transaction**.
- If the transaction's read sees an unexpected source state (e.g. already `succeeded`), it returns no-op rather than re-writing.

### 3.9 — Merchant-of-record / escheatment / dormant funds (NEW — D3 implication)

**Surface.** Under D3 (platform-collected), Teranga holds customer funds in transit. **Four scenarios** the architecture must address before launch — three failure modes plus a tax/receipt-issuance compliance obligation. None are coding tasks; they are **legal + ops policy** questions that need documented runbooks.

| Scenario | What's at stake | Required policy |
|---|---|---|
| **Event cancelled, organizer unreachable** | Customers paid; refunds need to be issued; the org's payout destination is silent or invalid. Funds sit in Teranga's PayDunya balance with no clear owner. | 12-month hold → Teranga issues refunds directly to participants (using their original payment instrument). After 24 months of inactivity, residual balance escheats per Senegalese consumer-protection guidance (BCEAO consultation required). |
| **Refund target unreachable** | Participant refunded; their Wave / OM number is closed; refund bounces back to Teranga's balance. | Hold for 90 days, attempt redelivery via support; after 90 days mark the refund `unclaimed` and surface in the super-admin dashboard for manual intervention. Never silently absorb. |
| **Chargeback liability** | Card-payment dispute (Phase 6+ when Stripe ships); customer charges back; we've already paid the org. | Two-stage payout + reserve: hold X% of every card payment for the chargeback window (typically 90 days); only that reserved portion is at risk if the org has been paid out and a chargeback hits. Mobile-money has near-zero chargeback risk so this is card-specific. |
| **Tax / receipt issuance** (compliance obligation, not a failure mode) | Teranga is merchant-of-record on the customer's bank / mobile-money statement → Teranga issues the customer receipt. | Receipt template (FR/EN/WO) names Teranga Events SRL as merchant; itemises the org's event title; carries the legal mention "réservé via la plateforme Teranga Events". |

**Status.** **Phase-6 blocker.** None of the above need to land before Phase 1-5 hardening / integration / UI work. But all four MUST have documented runbooks before the sandbox→live cutover at Phase 6.5. Tracked as a separate workstream that runs in parallel with engineering Phase 1-5; legal/ops owner needed.

---

## 4 · Reconciliation strategy

The provider's dashboard is the source of truth — not our database. **Under D3 (platform-collected), reconciliation is now safety-of-funds-critical, not just operational hygiene** — Teranga holds customer funds in transit, so any drift between PayDunya's view of the world and ours directly maps to "money we owe but don't know about" or "money we paid out twice". Alert thresholds tightened accordingly.

A complete reconciliation strategy has four moving parts:

### 4.1 — Daily bulk reconciliation

**What.** Cloud Scheduler fires `reconcile.daily` Pub/Sub at 02:00 Africa/Dakar every day. A Cloud Function calls each provider's `GET /transactions?from=YYY-MM-DD-1` and diffs against our `payments` collection for that day.

**Outputs.**

- `reconciliation_runs/{runId}` — a single doc per run with `status: ok|drift|error`, `providerTotal`, `localTotal`, `driftCount`, `driftIds[]`.
- `reconciliation_drifts/{driftId}` — one doc per discrepancy: missing locally, missing at provider, status mismatch, amount mismatch.
- **Alert thresholds (tightened for D3 platform-collected):** PagerDuty `level=warning` on **any** drift (`driftCount > 0`) with on-call response within **1 hour**. `level=critical` on `driftCount > 0.05 % of providerTotal` OR on **any** amount-mismatch finding (an amount mismatch on a single payment is a money-loss signal regardless of count). Drift below 0.01 % of providerTotal must be resolved within 24 h; everything else is investigated immediately.

**Why daily, not real-time.** Real-time reconciliation against the provider creates a sustained read load on the provider's API and increases our infrastructure cost without proportional value — the webhook + retry queue catches the vast majority of drift in under 5 minutes.

### 4.2 — Webhook retry queue

**What.** Webhooks that fail to process (signature error, transient Firestore error, business-logic exception) land in a `webhook_retry_queue/{id}` document. A Cloud Function consumes the queue with exponential backoff (1m → 5m → 15m → 1h → 6h → 24h, then dead-letter).

**Why.** Providers retry 2–5 times on their own, but the retry windows differ (Wave: 5/15/60/360 min; OM: 1/5/30 min). Our queue normalises the policy and absorbs the case where the provider gives up before our service comes back online.

### 4.3 — Manual replay console

**What.** Super-admin route `POST /v1/admin/webhooks/:id/replay` lets support manually re-process a webhook. Required for the case where a customer says "I paid via Wave 2 hours ago but the ticket isn't issued".

**Why.** Some drifts can only be resolved by a human reading the provider dashboard and clicking replay.

### 4.4 — Settlement report

**What.** Daily CSV export per organization with `gross / platform_fee / net_owed_to_org / payout_status / next_payout_eta`. Emailed to the org's finance contact at 03:00 Africa/Dakar.

**Why.** Under D3 (platform-collected) the org doesn't see the customer payment land in their account — they only see Teranga's batched payout arrive 1-3 days later. The settlement report bridges that opacity: every gross payment, every Teranga fee, every refund, and the resulting net-payable, attributed to a specific payout date. Organizers' accounting teams need this to reconcile their own books against ours.

### 4.5 — Org payout schedule + reserve policy (NEW — D3 implication)

**What.** Customer payments land in Teranga's PayDunya balance immediately. Org payouts are released on a schedule (default: T+3 weekdays from `payment.completedAt`, configurable per-org). For paid events, payout is held until **event end + 24 h** to absorb refund spikes during the event window. The 24-h post-event hold is the org-level equivalent of a card-payment reserve.

**Why.** Refund liability sits on Teranga; releasing payouts before the refund window closes creates a clawback need. The post-event hold removes that risk by ensuring the org can't cash out money that may need to be refunded.

**Override.** Super-admin can override the hold per-event (e.g. a multi-day festival where the org needs cash flow before day 1 ends). Override emits a domain event for audit; the override flag is surfaced on the payout doc.

---

## 5 · Subscription billing design (Phase 4)

**Per D3 (platform-collected):** organizers pay their SaaS subscription fees (`9 900 / 29 900 XOF / mo`) to Teranga's PayDunya account — same merchant account that collects ticket payments. No separate billing relationship. The flow is symmetric to ticket payments minus the org-payout step (subscription revenue stays with Teranga).

Mobile money has **no native recurring authorization** (unlike Stripe's saved card / SEPA mandate). PayDunya works around this with two patterns:

### 5.1 — Saved instrument + reminder-driven renewal (recommended)

The first subscription payment goes through the standard mobile-money OTP flow. PayDunya stores a `customer_token` we can re-use within a 12-month window. On renewal day:

1. We send the customer a **reminder push + SMS** 48 h ahead: "Your Pro plan renews on April 30. Tap to confirm in Wave."
2. On renewal day, we attempt the charge against the saved token. If it succeeds → silent renewal. If it fails (insufficient funds / expired token) → we fall back to the **manual checkout link**.
3. The customer has 7 days of grace period before the plan downgrades. During grace they retain Pro features but see a banner.

### 5.2 — Card-only recurring (Stripe phase)

For organizers who want true "set-and-forget" billing (no monthly OTP), they can attach a card via Stripe. Card subscriptions follow the standard SCA / 3DS flow.

### 5.3 — State machine

`subscription.status`: `trialing | active | past_due | grace_period | cancelled | unpaid`.

| Transition | Trigger |
|---|---|
| `trialing → active` | First successful payment after trial end |
| `active → past_due` | Renewal payment failed; reminder sent |
| `past_due → grace_period` | 24 h elapsed without retry success |
| `grace_period → cancelled` | 7 days elapsed without retry success → automatic plan downgrade |
| `* → cancelled` | Customer-initiated cancellation |
| `cancelled → active` | Customer re-subscribes |

Every transition emits a domain event. The audit listener writes `auditLogs` rows. The notification listener fires a localised email + SMS via the existing communication catalog.

---

## 6 · Phase 1 hardening backlog

> Each task has a **Done-when** line so completion is unambiguous. Tasks are ordered by safety-of-funds priority — fix the money-loss bugs first, then PII, then defensive depth. Estimated total: **5-7 working days for one engineer + reviewer**.

### 6.1 — Money safety (Day 1-2)

| ID | Task | Done when |
|---|---|---|
| **P1-01** | Fix C2: `payoutLocks/{orgId}_{eventId}_{periodFrom}_{periodTo}` sentinel inside `createPayout()` tx | Concurrent `Promise.all([createPayout(), createPayout()])` test produces exactly one `Payout` doc + one debit ledger entry; second call gets `ConflictError` |
| **P1-02** | Fix M1: move `refundLocks` create inside the refund transaction | Concurrent refund test produces exactly one provider call + 409 to the loser |
| **P1-03** | Fix H4: decrement `ticketTypes[].soldCount` in the same transaction as `registeredCount` on full refund | Test: register → refund → register → succeeds (no spurious `EventFullError`) |
| **P1-04** | Fix H5: merge the two `tx.update(eventRef, ...)` calls in `handleWebhook` success path; document the array-mutation invariant | Single `tx.update()` call; comment block flagging the invariant in `payment.service.ts` |
| **P1-05** | Fix M2: re-read payment amounts inside the `createPayout()` transaction (or query `balanceTransactions` for net) | Test: refund completing mid-payout-sweep doesn't double-count |

### 6.2 — Idempotency + duplicate prevention (Day 2-3)

| ID | Task | Done when |
|---|---|---|
| **P1-06** | Fix C1: `Idempotency-Key` header on `POST /v1/payments/initiate`; `payment_idempotency_keys/{id}` collection with 24h TTL | Test: same `Idempotency-Key` returns same `paymentId` on retry; different key creates new payment |
| **P1-07** | Fix H2: two-phase pattern — placeholder Payment doc BEFORE provider call, real `providerTransactionId` updated AFTER provider succeeds | Test: simulated provider success after artificial tx-2 abort still produces a clean record (no orphan provider session) |
| **P1-08** | Fix H3: capture `wasNewlySucceeded` flag inside webhook tx; emit `payment.succeeded` only on actual transition | Test: 5 concurrent identical webhooks produce exactly one `payment.succeeded` emit |

### 6.3 — Information security (Day 3-4)

| ID | Task | Done when |
|---|---|---|
| **P1-09** | Fix C3: introduce `PaymentClientView` projection (no `providerMetadata`, no `callbackUrl`); apply to `GET /v1/payments/:id/status`, `GET /v1/payments/event/:eventId`, `getEventPaymentSummary()` | Snapshot test of the 3 response shapes; no `providerMetadata` field present |
| **P1-10** | Fix C4: explicit `delete data.notif_token` in OM `initiate()`; update response type | Unit test asserts returned object's `Object.keys()` does not include `notif_token` |
| **P1-11** | Fix C5: providers throw typed `ProviderError(status, code)` with body logged separately | grep for `${body}` in provider Error constructors returns 0 hits; structured log carries the body |
| **P1-12** | Add per-event projection helper; ensure no service method ever returns raw `providerMetadata` outside the super-admin redacted path | Lint rule or test asserting the invariant |

### 6.4 — Plan + permission gates (Day 4)

| ID | Task | Done when |
|---|---|---|
| **P1-13** | Fix H1: `requirePlanFeature(org, "paidTickets")` at the top of `initiatePayment()` | Test: free org with a `price > 0` ticket gets `PlanLimitError` at payment init |
| **P1-14** | Verify (or add) `requireOrganizationAccess(user, payment.organizationId)` on `getPaymentStatus()` for ALL caller paths (not just the conditional non-admin branch) | Cross-org IDOR test: Org-A admin → Org-B payment status → 403 |

### 6.5 — Network defence + webhook hardening (Day 5)

| ID | Task | Done when |
|---|---|---|
| **P1-15** | Fix H6: per-provider IP allowlist env vars (`WAVE_WEBHOOK_IPS`, `OM_WEBHOOK_IPS`, `PAYDUNYA_WEBHOOK_IPS`); middleware checks `req.ip` BEFORE HMAC verify; fail-open if env unset (dev) | Test: webhook from non-allowlisted IP → 403 before any HMAC compute |
| **P1-16** | Fix M6: Zod validation on mock-checkout `/complete` route | `npx tsc --noEmit` clean; route test passes with valid body, rejects malformed |
| **P1-17** | Fix M4: webhook idempotency log uses transaction-state values, not outer-snapshot values | Audit row content matches transactional state |
| **P1-18** | Fix L3: startup assertion — if `WAVE_API_KEY` is set, `WAVE_API_SECRET` MUST be set; else throw at boot | Boot test: misconfigured env → API fails to start with a clear error message |

### 6.6 — Provider polish + cleanup (Day 5-6)

| ID | Task | Done when |
|---|---|---|
| **P1-19** | Fix M7: extend `RefundResult.reason` discriminated union; Wave provider maps HTTP/body to typed reason | Test: Wave 422 returns `reason: "provider_error"`; mocked timeout returns `reason: "network_timeout"` |
| **P1-20** | Fix M8: Promise-based memoization on OM OAuth token cache | Test: 10 concurrent `initiate()` calls produce exactly one OAuth fetch |
| **P1-21** | Fix L1: decide on `expired` status — implement cleanup job OR remove from schema | Either a `payment-expirer` Cloud Function lands OR the enum is shrunk + tests updated |
| **P1-22** | Fix L4: `IsoDateTimeSchema` on `CalculateQuery.periodFrom/periodTo` | Test: malformed date → 400 |

### 6.7 — Test coverage uplift (Day 6-7)

Land the 5 missing tests from §2 "Test coverage gaps":

- **P1-23** Concurrent webhook delivery test
- **P1-24** Refund amount math boundaries (0 / 1 / 9999 / 10000 / 10001 against a 10000 XOF payment)
- **P1-25** Webhook signature HMAC edge cases (empty / wrong-length / mutated body)
- **P1-26** Refund concurrent lock semantics
- **P1-27** Cross-org IDOR on payment read

### 6.8 — Deliverable

End of Phase 1, the following are true and verified by CI:

- `npx vitest run` clean (1665+ existing tests + ~12 new payment tests)
- `npx tsc --noEmit` clean across the monorepo
- `@security-reviewer` agent reports `✅` on the diff
- `@firestore-transaction-auditor` reports `✅`
- `@domain-event-auditor` reports `✅`
- `@plan-limit-auditor` reports `✅` (closes H1)

Phase 2 (PayDunya integration) starts on a known-clean foundation.

---

## 7 · Phase 2–6 plan (recap)

| Phase | Scope | Calendar |
|---|---|---|
| **Phase 0** ✅ | Audit + threat model + locked decisions (this document) | 3-4 days |
| **Phase 1** | Foundations: idempotency, money primitives, audit/event taxonomy, per-route rate limits, fix every Critical + High in §2 | 1 week |
| **Phase 2** | PayDunya provider implementation behind `PaymentProvider` interface; hosted-checkout redirect flow; webhook signature verification; sandbox end-to-end test | 1.5 weeks |
| **Phase 3** | Reconciliation: daily job + retry queue + manual replay + settlement report | 1 week |
| **Phase 4** | SaaS subscription billing on top of the same PayDunya provider; reminder-driven renewal; state machine + grace period | 1.5 weeks |
| **Phase 5** | UI: participant payment-method picker, organizer payments + refund console, **simplified org onboarding form (3 fields: payout destination type / account number / recipient name — NO PayDunya KYC redirect per D3)**, super-admin reconciliation drift viewer; full FR/EN/WO coverage | 1.5 weeks |
| **Phase 6** | Independent security review + production hardening checklist + **§3.9 escheatment + chargeback + receipt-issuance runbooks** + sandbox→live cutover with org-level feature flag | 1 week + parallel legal/ops workstream |

**Total calendar:** 7-9 weeks for one engineer + reviewer.

---

## 8 · Provider comparison (one-page reference)

| Capability | PayDunya | CinetPay | Stripe | Direct Wave | Direct OM |
|---|---|---|---|---|---|
| Wave (Senegal) | ✅ | ✅ | ❌ | ✅ | ❌ |
| Orange Money (SN/CI/ML/BF) | ✅ | ✅ | ❌ | ❌ | ✅ |
| Free Money (SN) | ✅ | ❌ | ❌ | ❌ | ❌ |
| MTN MoMo (CI/CM) | ❌ | ✅ | ❌ | ❌ | ❌ |
| Cards (Visa / MC) | ✅ (3DS) | ✅ | ✅ (best-in-class) | ❌ | ❌ |
| Split-payment to merchant | ✅ | ✅ | ✅ (Connect) | ❌ | ❌ |
| Saved instrument / token | ✅ (12-mo) | ✅ (limited) | ✅ (best) | ❌ | ❌ |
| Refund API | ✅ | ✅ | ✅ | ✅ | partial |
| Sandbox quality | good | good | excellent | basic | basic |
| Onboarding time | 1-2 weeks | 1-2 weeks | 1-2 days | 6-10 weeks | 4-8 weeks |
| Aggregation fee | ~1.5 % | ~1.0 % | n/a | 0 % | 0 % |
| Native FCFA support | ✅ | ✅ | partial | ✅ | ✅ |
| Documentation language | French | French | English | French | French |

**Decision:** PayDunya in Phase 2. CinetPay added in Phase 6+ for Côte d'Ivoire / multi-region. Stripe added when international card volume justifies it.

---

## 9 · Out of scope (explicitly)

- BNPL ("buy now, pay later") integrations.
- Cryptocurrency / stablecoin payments.
- Recurring credit-card subscriptions (deferred to Stripe phase).
- Marketplace seller-onboarding / KYC for organizers (per D3, Teranga is the only PayDunya merchant; orgs only provide a payout destination — Wave / OM / bank account).
- Subscription proration / plan-mid-cycle changes (Phase 4 supports plan changes only at renewal boundary; mid-cycle proration is a Phase 4.5 follow-up).
- Multi-currency display (XOF-only v1; EUR display + FX conversion is a Phase 5+ option).
- Tax / VAT computation (Senegal does not currently apply VAT to event tickets; revisit when expanding to a VAT jurisdiction).

---

## 10 · Risks & garde-fous

| Risk | Mitigation |
|---|---|
| PayDunya outage during a peak event registration window | Composite-key rate limit + retry queue absorbs short outages. For prolonged outages, fallback to manual ticket issuance via super-admin console. |
| Reconciliation drift > 0 (D3 tightened threshold) | Daily job + PagerDuty `level=warning` on any drift, `level=critical` on amount-mismatch OR > 0.05 % drift. SLA: 1 h response, 24 h resolution. |
| **Merchant-of-record posture (D3)** — Teranga visible on customer's bank/MoMo statement; chargeback notices arrive at Teranga; refund liability sits on Teranga | Three-pronged mitigation: (a) post-event payout hold (event end + 24 h) absorbs refund spikes before paying the org out; (b) reserve % on card payments when Stripe ships (mobile money has near-zero chargeback so phase 1-4 unaffected); (c) §3.9 runbooks define escheatment / unreachable-org / unclaimed-refund policy. |
| **Org payout-destination invalid** — operator typo'd Wave merchant number; payout bounces back into Teranga balance | Validation at org-onboarding time (PayDunya provides a "verify recipient" probe API). On payout failure, surface in super-admin dashboard within 1 h; auto-retry every 24 h for 7 days; escalate to support after 7 failed retries. |
| Subscription saved-token expiration (12 mo) | Renewal reminder switches to manual checkout link 7 days before token expiry. |
| Provider fee change without notice | Fee values are env vars (`PAYDUNYA_FEE_PCT`), not hardcoded. Post-change re-run of historical reconciliation flags affected payments. |
| Senegalese consumer-protection regulator inquiry | Audit log on every state transition + 7-year retention on `payments` + `auditLogs` (super-admin can soft-archive but never hard-delete). |
| Dispute / chargeback (cards) | Mobile-money first — chargeback rate is ~0. Card dispute workflow shipped with Stripe phase. |
| Operator accidental refund of a paid out payment | Two-stage refund UI: organizer initiates → super-admin approves for refunds > 50 000 XOF or > 7 days post-event. |

---

## 11 · Annexes

- **Branch:** `claude/payments-phase-0-audit` (forked from `origin/develop` at `5fdac2a`).
- **Sources:** 3 parallel agent deep-reviews (code-quality / security / atomicity) + senior-engineer synthesis.
- **No source-code modifications during Phase 0** — read-only audit.
- **Next:** Phase 1 hardening branch + draft PR opens against `develop` once this report is approved.

— End of Phase 0 audit.
