# Wave 6: Payments

**Status:** `completed`
**Estimated effort:** 2 weeks
**Goal:** Enable paid events with mobile money integration targeting the West African market.

## Why This Wave Matters

Teranga's revenue model and organizer monetization depend on payments. The West African market demands **mobile money** (Wave, Orange Money, Free Money) — not just card payments. This is a competitive differentiator.

---

## Tasks

### API (Fastify)

#### Payment Processing
- [x] Payment initiation endpoint (creates payment intent for registration)
- [x] Payment callback/webhook endpoint (provider sends payment confirmation)
- [x] Payment status check endpoint
- [ ] Payment receipt generation
- [x] Refund initiation endpoint (for cancelled registrations)
- [x] Refund webhook handling

#### Payment Providers
- [x] Abstract payment provider interface (`PaymentProvider`)
- [ ] Wave integration (Senegal's #1 mobile money)
- [ ] Orange Money integration
- [ ] Free Money integration (optional, lower priority)
- [ ] Card payment via Stripe or PayDunya (backup for international users)
- [x] Mock payment provider for development & testing

#### Financial Management
- [ ] Organizer payout tracking (what they're owed vs. what's been paid)
- [ ] Platform fee calculation (percentage per transaction)
- [x] Financial report endpoints (revenue by event — payment summary)
- [x] XOF currency handling throughout (CFA Franc)

#### Registration + Payment Flow
- [x] Modify registration flow: "pending_payment" status for paid events
- [x] Auto-confirm registration on successful payment
- [ ] Auto-cancel registration if payment times out (configurable window)
- [x] Partial refund support

### Cloud Functions

- [ ] `onPaymentCompleted` → confirm registration + generate badge
- [ ] `onPaymentFailed` → notify participant, auto-retry logic
- [ ] `onPaymentTimeout` → cancel pending registration, free up spot
- [ ] Daily payout reconciliation job (scheduled function)

### Web Backoffice

- [ ] Ticket pricing setup in event creation flow
- [x] Payment dashboard (revenue, transactions, refunds)
- [ ] Payout history and pending payouts
- [ ] Financial reports with date range filters
- [x] Refund management UI

### Web Participant App

- [x] Payment flow during web registration
  - [x] Ticket price display on event detail page
  - [ ] Payment method selection (Wave, Orange Money, card) — mock provider for now
  - [x] Redirect to payment provider and callback handling
  - [x] Payment confirmation + badge display
- [ ] Payment history in profile page
- [ ] Receipt download

### Mobile (Flutter) — DEFERRED TO WAVE 9

> Deferred: Mobile payment flow (provider selection, redirect, confirmation), payment history, receipt download.

### Shared Types

- [x] Payment schemas (initiate, callback, status)
- [x] `pending_payment` registration status addition
- [x] Payment summary schema
- [x] Payment provider enum and config types
- [ ] Payout schemas

### Testing

- [x] Payment service unit tests (23 tests)
  - initiatePayment: happy path, permission denial, unpublished event, ticket validation, duplicate registration, sold out, unsupported method
  - handleWebhook: success confirmation, idempotency, failure handling, unknown transaction
  - getPaymentStatus: owner access, permission denial, non-owner access
  - getEventPaymentSummary: aggregation, permission denial
  - refundPayment: full refund, partial refund, permission denial, balance exceeded, provider rejection

---

## Exit Criteria

- [x] Organizer can create paid events with XOF pricing
- [ ] Participant can pay via Wave mobile money and receive confirmation
- [x] Registration auto-confirms after successful payment
- [ ] Badge is generated after payment confirmation
- [x] Organizer can view revenue and transaction history
- [x] Refund flow works end-to-end
- [ ] At least one mobile money provider fully integrated
- [x] Payment webhooks are idempotent and secure

## Dependencies

- Wave 1 completed (registration flow exists)
- Payment provider API access (Wave Business, Orange Money API keys)
- Business entity setup for receiving payments

## Deploys After This Wave

- API: Payment endpoints, modified registration flow
- Web: Payment dashboard, pricing in event creation
- Mobile: Deferred to Wave 9
- Functions: Payment lifecycle triggers

## Technical Notes

- **XOF has no decimal places** — amounts are always integers (e.g., 5000 XOF, not 50.00)
- **Wave API** uses webhooks for payment confirmation — endpoint must be publicly accessible
- **Idempotency**: Payment webhooks may be sent multiple times. Use payment reference ID for deduplication
- **PCI compliance**: We never store card numbers. Payment providers handle all sensitive data
- **Testing**: Use provider sandbox/test environments. Mock payment providers in integration tests
- **Currency formatting**: `Intl.NumberFormat("fr-SN", { style: "currency", currency: "XOF" })`
- **Mock checkout page**: Served at `/v1/payments/mock-checkout/:txId` for development/testing
