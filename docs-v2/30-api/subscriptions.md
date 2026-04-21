# Subscriptions API

> **Status: shipped** (upgrade/downgrade/cancel). Dynamic billing (Wave/OM payments for subscriptions) is planned.

Base path: `/v1/organizations/:orgId/subscription`

---

## Get current subscription

```
GET /v1/organizations/:orgId/subscription
```

**Auth:** Required  
**Permission:** `organization:read` + org membership

**Response:**

```json
{
  "success": true,
  "data": {
    "plan": "starter",
    "status": "active",
    "currentPeriodStart": "2026-04-01T00:00:00Z",
    "currentPeriodEnd": "2026-05-01T00:00:00Z",
    "billingCycle": "monthly",
    "priceXof": 9900,
    "scheduledChange": null
  }
}
```

---

## Get usage

```
GET /v1/organizations/:orgId/usage
```

**Auth:** Required  
**Permission:** `organization:read` + org membership

Computes current usage vs plan limits on demand (no cached values).

**Response:**

```json
{
  "success": true,
  "data": {
    "plan": "starter",
    "limits": {
      "maxEvents": { "current": 4, "limit": 10, "allowed": true, "percent": 40 },
      "maxMembers": { "current": 2, "limit": 3, "allowed": true, "percent": 67 },
      "maxParticipantsPerEvent": { "current": 87, "limit": 200, "allowed": true, "percent": 44 }
    },
    "features": {
      "qrScanning": true,
      "customBadges": true,
      "csvExport": true,
      "smsNotifications": false,
      "advancedAnalytics": false,
      "paidTickets": false,
      "promoCodes": true,
      "speakerPortal": false,
      "sponsorPortal": false,
      "apiAccess": false,
      "whiteLabel": false
    }
  }
}
```

---

## Upgrade plan

```
POST /v1/organizations/:orgId/subscription/upgrade
```

**Auth:** Required  
**Permission:** `organization:update` + org membership (owner)

Takes effect immediately. `effectiveLimits` is refreshed on the org document.

**Request body:**

```typescript
{
  plan: 'starter' | 'pro' | 'enterprise';
  billingCycle?: 'monthly' | 'annual';    // default: 'monthly'
}
```

Emits `subscription.upgraded` domain event.

---

## Downgrade plan

```
POST /v1/organizations/:orgId/subscription/downgrade
```

**Auth:** Required  
**Permission:** `organization:update` + org membership (owner)

Validates that current usage fits within the target plan limits. If downgrading mid-period, sets `scheduledChange` to apply at `currentPeriodEnd` (honors prepaid period).

**Request body:**

```typescript
{
  plan: 'free' | 'starter' | 'pro';
}
```

**Validation errors (before queuing):**

```json
{
  "error": {
    "code": "DOWNGRADE_BLOCKED",
    "message": "You have 12 active events but the Starter plan allows only 10.",
    "details": {
      "blockers": [
        { "resource": "maxEvents", "current": 12, "limit": 10 }
      ]
    }
  }
}
```

Emits `subscription.change_scheduled` domain event.

---

## Cancel scheduled change

```
POST /v1/organizations/:orgId/subscription/change/revert
```

**Auth:** Required  
**Permission:** `organization:update` + org membership (owner)

Cancels a queued downgrade before it takes effect.

Emits `subscription.scheduled_reverted` domain event.

---

## List public plans

```
GET /v1/plans
```

**Auth:** None  
**Permission:** Public

Returns the Free, Starter, and Pro plans (Enterprise is omitted from the public list).
