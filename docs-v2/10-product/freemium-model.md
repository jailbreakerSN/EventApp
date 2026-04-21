# Freemium Model

> **Status: shipped** — Plan enforcement is live. Dynamic plan catalog (Phase 2–6 migration) is in progress.

---

## Plan tiers

| | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| **Price** | 0 XOF | 9 900 XOF/mo | 29 900 XOF/mo | Custom |
| **Max events (active)** | 3 | 10 | Unlimited | Unlimited |
| **Max participants/event** | 50 | 200 | 2 000 | Unlimited |
| **Max team members** | 1 | 3 | 50 | Unlimited |
| QR scanning | — | ✅ | ✅ | ✅ |
| Custom badges | — | ✅ | ✅ | ✅ |
| CSV export | — | ✅ | ✅ | ✅ |
| Promo codes | — | ✅ | ✅ | ✅ |
| Paid tickets | — | — | ✅ | ✅ |
| SMS notifications | — | — | ✅ | ✅ |
| Advanced analytics | — | — | ✅ | ✅ |
| Speaker portal | — | — | ✅ | ✅ |
| Sponsor portal | — | — | ✅ | ✅ |
| API access | — | — | — | ✅ |
| White-label | — | — | — | ✅ |

---

## How limits are enforced

Plan enforcement happens in three places — all must agree:

### 1. API service layer (primary)

Every mutating operation that could hit a limit calls `BaseService.checkPlanLimit()` or `BaseService.requirePlanFeature()` before writing to Firestore:

```typescript
// In EventService.create()
const limitCheck = await this.checkPlanLimit(org, 'maxEvents', activeEventCount);
if (!limitCheck.allowed) {
  throw new PlanLimitError('maxEvents', limitCheck.current, limitCheck.limit);
}

// In EventService.createTicketType() — for paid tickets
await this.requirePlanFeature(org, 'paidTickets');
```

### 2. Frontend gating (soft wall)

The `<PlanGate>` component in `apps/web-backoffice/src/components/plan/PlanGate.tsx` wraps features with a blur overlay + upgrade CTA. This is a UI convenience — the API enforces the real gate.

```tsx
<PlanGate feature="advancedAnalytics" fallback="blur">
  <AnalyticsDashboard />
</PlanGate>
```

### 3. `effectiveLimits` on the org document (Phase 2+)

A denormalized `effectiveLimits` and `effectiveFeatures` object is stored on each org document for fast plan lookups without an extra Firestore read. During the Phase 2→6 migration, the API falls back to the hardcoded `PLAN_LIMITS` constant if `effectiveLimits` is absent.

See [Freemium enforcement concept](../20-architecture/concepts/freemium-enforcement.md) for the full Phase 2–6 migration plan.

---

## Grace period rule

**Registration limits are not enforced once an event has started.** If `event.startDate < now`, the `maxParticipantsPerEvent` check is skipped. This prevents plan gates from blocking check-in at a live event.

---

## PlanLimitError

When a limit is exceeded, the API returns:

```json
{
  "success": false,
  "error": {
    "code": "PLAN_LIMIT_EXCEEDED",
    "message": "Your Free plan allows a maximum of 3 active events.",
    "details": {
      "resource": "maxEvents",
      "current": 3,
      "limit": 3,
      "requiredPlan": "starter"
    }
  }
}
```

---

## Subscription lifecycle

```
Organization created
    └─► Subscription doc created (plan: free, status: active)
          └─► Upgrade (POST /v1/organizations/:id/subscription/upgrade)
                ├── New plan takes effect immediately
                ├── effectiveLimits backfilled on org doc
                └─► Downgrade queues a scheduledChange
                      └─► Daily rollover job (Cloud Scheduler) applies the change at period end
```

Subscription documents are stored in the `subscriptions` collection. The plan catalog is in the `plans` collection (managed by super-admins via `/v1/admin/plans`).

---

## Usage API

The organizer dashboard shows current usage vs plan limits:

```
GET /v1/organizations/:orgId/usage
```

Response:

```json
{
  "plan": "starter",
  "limits": {
    "maxEvents": { "current": 4, "limit": 10, "allowed": true },
    "maxMembers": { "current": 2, "limit": 3, "allowed": true },
    "maxParticipantsPerEvent": { "current": 87, "limit": 200, "allowed": true }
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
```

---

## Frontend hook

```typescript
const { plan, canUse, checkLimit, isNearLimit } = usePlanGating();

// Feature check
if (!canUse('smsNotifications')) { /* show upgrade CTA */ }

// Usage check
const { allowed, current, limit, percent } = checkLimit('maxEvents');
if (isNearLimit('maxEvents')) { /* show yellow warning */ } // >= 80% usage
```
