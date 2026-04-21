# Freemium Enforcement — effectiveLimits Architecture

> **Status: partial** — Phase 2 (denormalization) is in progress. The fallback to hardcoded `PLAN_LIMITS` is still active.

---

## The problem: who owns the plan definition?

Early in the codebase, plan limits were defined in a single constant:

```typescript
// packages/shared-types/src/organization.types.ts
export const PLAN_LIMITS: Record<OrganizationPlan, PlanLimits> = {
  free: { maxEvents: 3, maxParticipantsPerEvent: 50, maxMembers: 1, features: { ... } },
  starter: { maxEvents: 10, ... },
  pro: { maxEvents: Infinity, ... },
  enterprise: { maxEvents: Infinity, ... },
};
```

This works for a fixed set of plans but breaks when:
- A super-admin wants to grant a specific org a custom limit (e.g., free plan but 500 participants)
- A new plan tier is added without a code deploy
- Enterprise contracts have negotiated custom pricing

The solution is a **dynamic plan catalog** in Firestore (`plans` collection) with per-org overrides — while keeping the hardcoded constant as a compile-time safety net and seed source.

---

## The six-phase migration

### Phase 1 — Hardcoded constant (shipped, legacy)

All service-layer checks read directly from `PLAN_LIMITS[org.plan]`. Zero Firestore reads for plan enforcement. No flexibility.

```typescript
const limits = PLAN_LIMITS[org.plan]; // hardcoded
```

### Phase 2 — Denormalize onto org doc (in progress, April 2026)

`PlanService.getEffectiveForOrganization()` computes the effective limits and stores them on the org document:

```typescript
// On org document:
{
  effectiveLimits: { maxEvents: 10, maxParticipantsPerEvent: 200, maxMembers: 3 },
  effectiveFeatures: { qrScanning: true, customBadges: true, ... },
  effectivePlanKey: 'starter',
  effectiveComputedAt: '2026-04-21T10:00:00Z'
}
```

Services read from `org.effectiveLimits` when present, falling back to `PLAN_LIMITS` during the rollout:

```typescript
function getOrgLimits(org: Organization): PlanLimits {
  if (org.effectiveLimits && org.effectivePlanKey) {
    return {
      maxEvents: org.effectiveLimits.maxEvents === -1 ? Infinity : org.effectiveLimits.maxEvents,
      maxParticipantsPerEvent: ...,
      maxMembers: ...,
      features: org.effectiveFeatures ?? {},
    };
  }
  // fallback during migration
  return PLAN_LIMITS[org.plan];
}
```

> Note: Firestore stores `-1` for unlimited (Firestore cannot store `Infinity`). The constant `PLAN_LIMIT_UNLIMITED = -1` is converted to `Infinity` at runtime.

### Phase 3 — effectiveLimits becomes authoritative (planned)

Once all orgs are backfilled (via seed-staging + backfill script), remove the `PLAN_LIMITS` fallback in service code. Keep the constant only for tests and seed scripts.

### Phase 4c — Subscription scheduled changes (partially shipped)

Downgrades queue a `scheduledChange` on the subscription document instead of immediately switching the plan. The daily Cloud Scheduler job (`applySubscriptionRollovers`) applies the change when `currentPeriodEnd` passes:

```typescript
// subscription document
{
  plan: 'pro',
  scheduledChange: {
    planKey: 'starter',
    effectiveAt: '2026-05-01T00:00:00Z'
  }
}
```

### Phase 5 — Super-admin per-org overrides (planned)

The `subscription.overrides` field allows super-admins to grant custom limits to specific orgs:

```typescript
// subscription document
{
  plan: 'free',
  overrides: {
    maxEvents: 20,        // override: free plan gets 20 events
    features: {
      customBadges: true  // override: free plan gets custom badges
    }
  }
}
```

`getEffectiveForOrganization()` merges the base plan limits with the overrides.

### Phase 6 — Remove hardcoded constant (planned)

Once all code paths read from `effectiveLimits` and all orgs are backfilled, the `PLAN_LIMITS` constant can be removed from production code.

---

## effectiveLimits invalidation

`effectiveLimits` must be refreshed whenever:
- The subscription plan changes (upgrade, downgrade, rollover)
- A super-admin creates or updates a plan in the catalog
- A super-admin sets or removes per-org overrides

This is handled by the `effective-plan.listener.ts` domain event listener, which subscribes to:
- `subscription.upgraded`
- `subscription.downgraded`
- `subscription.period_rolled_over`
- `plan.updated`

And calls `PlanService.backfillEffectiveLimits(orgId)` as a fire-and-forget operation.

---

## Service-layer enforcement API

`BaseService` provides two enforcement helpers:

```typescript
// Throws PlanLimitError if feature is disabled for this org
await this.requirePlanFeature(org, 'smsNotifications');

// Returns { allowed, current, limit } — never throws
const check = await this.checkPlanLimit(org, 'maxEvents', currentActiveEventCount);
if (!check.allowed) {
  throw new PlanLimitError('maxEvents', check.current, check.limit);
}
```

### Where limits are enforced

| Check | Location | When |
|---|---|---|
| `maxEvents` | `EventService.create()`, `EventService.clone()` | Before creating/cloning an event |
| `maxParticipantsPerEvent` | `RegistrationService.register()` | Before confirming registration (skipped if event has started) |
| `paidTickets` | `EventService.createTicketType()` | When creating a ticket with `price > 0` |
| `maxMembers` | `OrganizationService.addMember()`, `InviteService.accept()` | Before adding a member |
| Feature flags | Various services | Via `requirePlanFeature()` |

---

## Frontend enforcement

Frontend enforcement is a UX layer only — it is never a security boundary.

```tsx
// PlanGate.tsx
<PlanGate feature="advancedAnalytics" fallback="blur">
  <AnalyticsDashboard />
</PlanGate>
```

Fallback modes:
- `blur` — renders with blur overlay + "Upgrade" CTA
- `hidden` — renders nothing
- `disabled` — renders at reduced opacity, pointer events disabled

The `usePlanGating()` hook reads the org's current plan from the auth context and checks features/limits locally. It does not make API calls — it reads from the JWT claims which are refreshed on sign-in.
