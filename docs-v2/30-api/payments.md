---
title: Payments API
status: shipped
last_updated: 2026-04-25
---

# Payments API

> **Status: partial** — Wave and Orange Money are wired. Card (PayDunya/Stripe) and Free Money are stubs.

Base path: `/v1/payments`

---

## Initiate payment

```
POST /v1/payments/initiate
```

**Auth:** Required  
**Permission:** `registration:create` (participant)  
**Requires:** Pending registration with `status: 'pending_payment'`

**Request body:**

```typescript
{
  registrationId: string;
  method: 'wave' | 'orange_money' | 'free_money' | 'card' | 'mock';
  returnUrl: string;               // browser redirect after payment
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "paymentId": "pay_abc",
    "status": "pending",
    "redirectUrl": "https://wave.com/pay/...",    // redirect user here to complete payment
    "expiresAt": "2026-04-21T11:00:00Z"           // payment expires in 1 hour
  }
}
```

The client must redirect the user to `redirectUrl` to complete the mobile money payment. For mock payments (local dev), no redirect is needed — the webhook fires automatically.

**Payment method availability:**

| Method | Status | Notes |
|---|---|---|
| `wave` | ✅ shipped | Senegal USSD redirect flow |
| `orange_money` | ✅ shipped | OAuth2-cached token flow |
| `mock` | ✅ shipped | Auto-succeeds, for local dev/testing |
| `free_money` | 🔲 stub | Pending Free Money provider API |
| `card` | 🔲 stub | Pending PayDunya/Stripe integration |

---

## Payment webhook

```
POST /v1/payments/webhook
```

**Auth:** Provider-specific HMAC signature validation (not Firebase Auth)  
**Permission:** Internal — provider callback

This endpoint is called by Wave/Orange Money when a payment status changes. The request body format varies by provider. The API validates the signature, updates payment and registration status, and triggers badge generation on success.

**Do not call this endpoint directly** — it is for payment provider callbacks only.

---

## Get my payment history

```
GET /v1/payments
```

**Auth:** Required  
**Permission:** `registration:read_own`

Returns the authenticated user's payment history.

---

## Get event payment history (organizer)

```
GET /v1/payments/event/:eventId
```

**Auth:** Required  
**Permission:** `registration:read_all` + org membership

Returns all payments for the event including amounts, methods, and statuses.

---

## Get balance (organizer)

```
GET /v1/organizations/:orgId/balance
```

**Auth:** Required  
**Permission:** `organization:read` + org membership (owner)

Returns available balance, pending amount (7-day hold), and lifetime payout total.

---

## Get transactions (ledger)

```
GET /v1/organizations/:orgId/transactions
```

**Auth:** Required  
**Permission:** `organization:read` + org membership

Returns the balance transaction ledger (payment, platform_fee, refund, payout, adjustment entries).

**Query parameters:** `page`, `limit`, `type`, `status`

---

## Get payout history

```
GET /v1/payouts/org/:orgId
```

**Auth:** Required  
**Permission:** `organization:read` + org membership (owner or super_admin)
