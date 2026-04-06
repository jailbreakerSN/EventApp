# Wave 6: Payments

**Status:** `not_started`
**Estimated effort:** 2 weeks
**Goal:** Enable paid events with mobile money integration targeting the West African market.

## Why This Wave Matters

Teranga's revenue model and organizer monetization depend on payments. The West African market demands **mobile money** (Wave, Orange Money, Free Money) — not just card payments. This is a competitive differentiator.

---

## Tasks

### API (Fastify)

#### Payment Processing
- [ ] Payment initiation endpoint (creates payment intent for registration)
- [ ] Payment callback/webhook endpoint (provider sends payment confirmation)
- [ ] Payment status check endpoint
- [ ] Payment receipt generation
- [ ] Refund initiation endpoint (for cancelled registrations)
- [ ] Refund webhook handling

#### Payment Providers
- [ ] Abstract payment provider interface (`PaymentProvider`)
- [ ] Wave integration (Senegal's #1 mobile money)
- [ ] Orange Money integration
- [ ] Free Money integration (optional, lower priority)
- [ ] Card payment via Stripe or PayDunya (backup for international users)

#### Financial Management
- [ ] Organizer payout tracking (what they're owed vs. what's been paid)
- [ ] Platform fee calculation (percentage per transaction)
- [ ] Financial report endpoints (revenue by event, by period)
- [ ] XOF currency handling throughout (CFA Franc)

#### Registration + Payment Flow
- [ ] Modify registration flow: "pending_payment" status for paid events
- [ ] Auto-confirm registration on successful payment
- [ ] Auto-cancel registration if payment times out (configurable window)
- [ ] Partial refund support

### Cloud Functions

- [ ] `onPaymentCompleted` → confirm registration + generate badge
- [ ] `onPaymentFailed` → notify participant, auto-retry logic
- [ ] `onPaymentTimeout` → cancel pending registration, free up spot
- [ ] Daily payout reconciliation job (scheduled function)

### Web Backoffice

- [ ] Ticket pricing setup in event creation flow
- [ ] Payment dashboard (revenue, transactions, refunds)
- [ ] Payout history and pending payouts
- [ ] Financial reports with date range filters
- [ ] Refund management UI

### Web Participant App

- [ ] Payment flow during web registration
  - [ ] Ticket price display on event detail page
  - [ ] Payment method selection (Wave, Orange Money, card)
  - [ ] Redirect to payment provider and callback handling
  - [ ] Payment confirmation + badge display
- [ ] Payment history in profile page
- [ ] Receipt download

### Mobile (Flutter) — DEFERRED TO WAVE 9

> Deferred: Mobile payment flow (provider selection, redirect, confirmation), payment history, receipt download.

### Shared Types

- [ ] Payment schemas (initiate, callback, status)
- [ ] `pending_payment` registration status addition
- [ ] Financial report schemas
- [ ] Payment provider enum and config types
- [ ] Payout schemas

---

## Exit Criteria

- [ ] Organizer can create paid events with XOF pricing
- [ ] Participant can pay via Wave mobile money and receive confirmation
- [ ] Registration auto-confirms after successful payment
- [ ] Badge is generated after payment confirmation
- [ ] Organizer can view revenue and transaction history
- [ ] Refund flow works end-to-end
- [ ] At least one mobile money provider fully integrated
- [ ] Payment webhooks are idempotent and secure (signature verification)

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
