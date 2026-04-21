# ADR-0006: Denormalize plan limits onto org document

**Status:** Accepted  
**Date:** 2026-02

---

## Context

Every plan-gated operation in the API needs to know the org's current limits. Three options:

1. **Hardcode** — `PLAN_LIMITS[org.plan]` constant in code. Zero reads, zero flexibility.
2. **Live lookup** — `db.collection('plans').doc(org.plan).get()` on every request. One extra Firestore read per request.
3. **Denormalize** — store resolved `effectiveLimits` on the org document. Zero extra reads, full flexibility.

The hardcoded constant works for the MVP but cannot support:
- Super-admin custom overrides per org
- Adding new plans without a code deploy
- Scheduled plan changes (downgrade at period end)

A live lookup adds a Firestore read to every API call that touches plan limits (event creation, registration, member add, etc.) — this is 1–2 reads per request in normal flows, which adds up at scale.

---

## Decision

**Store resolved `effectiveLimits`, `effectiveFeatures`, and `effectivePlanKey` on the organization document, recomputed whenever the subscription changes.**

```typescript
// On the org document
interface Organization {
  // ...
  effectiveLimits?: {
    maxEvents: number;          // -1 = unlimited (Firestore can't store Infinity)
    maxParticipantsPerEvent: number;
    maxMembers: number;
  };
  effectiveFeatures?: PlanFeatures;
  effectivePlanKey?: string;
  effectiveComputedAt?: string;  // ISO timestamp for staleness detection
}
```

---

## Invalidation triggers

`effectiveLimits` is recomputed when:
- Subscription is upgraded or downgraded
- Subscription period rolls over
- Super-admin creates or updates a plan
- Super-admin sets per-org overrides

Recomputation is triggered via the domain event bus (fire-and-forget listener `effective-plan.listener.ts`).

---

## Staleness handling

`effectiveComputedAt` is stored so a monitoring query can detect orgs whose limits haven't been refreshed recently. The fallback to `PLAN_LIMITS[org.plan]` during the Phase 2–6 migration handles temporary staleness gracefully.

---

## Trade-offs

| Concern | Impact |
|---|---|
| Write amplification | One extra write per org on plan changes. Acceptable — plan changes are infrequent. |
| Staleness window | Limits could be slightly stale between the subscription event and the listener completing (~100ms). Acceptable — plan limits are not real-time financial transactions. |
| Migration complexity | Requires a backfill script to populate `effectiveLimits` on existing orgs. The seed-staging job runs this on every staging deploy. |

---

## Consequences

- `PLAN_LIMITS` constant is kept during the migration (Phases 2–6) as a fallback and seed source. Marked `@deprecated Phase 6`.
- Services should read `org.effectiveLimits` when present and fall back to `PLAN_LIMITS` otherwise.
- The Admin SDK Firestore path is: `organizations/{orgId}` — do not cache this document for more than 5 minutes in-process.
