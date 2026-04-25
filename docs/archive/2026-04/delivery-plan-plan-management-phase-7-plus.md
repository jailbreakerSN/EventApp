# Plan Management — Phase 7+ Strategic Roadmap

**Status:** Proposed (for investment prioritization)
**Scope:** Post-Phase-6 enhancements to the plan/subscription/billing subsystem.
**Audience:** Engineering leads + product owner.

Phases 1-6 shipped the dynamic plan foundation (catalog in Firestore, denormalized effective fields on orgs, superadmin CRUD UI, `pricingModel`, prepaid period honoring, per-org override drawer, web client decoupled from static tables). This document is the **menu of post-foundation investments** — each item is sized, sequenced by ROI, and includes a concrete first-commit sketch so anyone can pick it up without re-reading the whole plan history.

---

## 0. Cumulative state after Phase 6

| #   | Phase                   | Shipped                                                                    |
| --- | ----------------------- | -------------------------------------------------------------------------- |
| 1   | Catalog foundation      | `plans` Firestore collection, superadmin-managed                           |
| 2   | Denormalization         | `org.effectiveLimits/Features/PlanKey/ComputedAt`                          |
| 3   | Enforcement cutover     | API reads `org.effectiveLimits`; legacy `PLAN_LIMITS` is fallback only     |
| 4   | Superadmin catalog UI   | `/admin/plans` CRUD pages + list                                           |
| 4b  | `pricingModel`          | `free / fixed / custom / metered` — kills the Enterprise "Gratuit" bug     |
| 4c  | Prepaid period honoring | `scheduledChange` + daily rollover Cloud Function (`cancel_at_period_end`) |
| 5   | Per-org override        | `/admin/organizations` assign dialog with per-dimension opt-in overrides   |
| 6   | Client decoupling       | Back-office reads from `usePlansCatalog()` via the public `GET /v1/plans`  |

**Test coverage at end of Phase 6:**

- `apps/api` — 667 tests
- `packages/shared-types` — 25 tests
- `apps/web-backoffice` — type-checked; no dedicated component-test suite yet
- `apps/functions` — type-checked; the rollover trigger is covered via the extracted worker unit tests on the API side

---

## Ordering principle

Items are ordered by **revenue-proximate ROI × unlock value**:

- **ROI-proximate** means the change directly affects what we can charge, who pays, or who churns.
- **Unlock value** means the change enables later items without forcing a rewrite.

We avoid "nice-to-have" abstractions that don't sit on a clear revenue or churn lever.

| Rank | Item                                     | Effort | Revenue lever                        | Unlocks                                         |
| ---- | ---------------------------------------- | ------ | ------------------------------------ | ----------------------------------------------- |
| 1    | **Plan versioning & grandfathering**     | M      | Protects MRR on edits                | Every future catalog change                     |
| 2    | **Unified entitlement model**            | M-L    | Meters + add-ons + quotas            | Metered pricing, add-ons, feature flags         |
| 3    | **Billing cycle (monthly/annual)**       | S-M    | +15-20% ARR uplift                   | Annual discounting, prepaid revenue recognition |
| 4    | **Trial periods**                        | S      | Free→Pro conversion                  | Freemium funnel analytics                       |
| 5    | **MRR / cohort dashboard**               | S-M    | Decision-making, not revenue         | Investment prioritization, churn alerting       |
| 6    | **Plan-change dry-run / impact preview** | S      | Protects superadmin from regressions | Safer pricing experimentation                   |
| 7    | **Plan-level coupons**                   | S      | Promo campaigns, partner deals       | Referral economics                              |
| 8    | **Parent-child orgs (agencies)**         | L      | West-African agency market           | Reseller revenue, enterprise deals              |

**Sizing legend:** S ≈ 3–5 days, M ≈ 1–2 weeks, L ≈ 3–4 weeks. All estimates include tests + docs, exclude review cycles.

---

## 7 — Plan versioning & grandfathering · Effort: M

### Why first

Today, when a superadmin edits `pro`, the change propagates to every existing pro org immediately (because the Phase 2-3 denormalization pipeline rewrites `org.effectiveLimits`). That's correct for fixing typos, but **silently dangerous** for pricing or quota changes:

- Raise `pro.maxEvents` from 10 → 20 → every pro customer gets a free upgrade, no revenue impact but no audit trail of who benefited.
- **Lower** it from 10 → 5 → every pro customer in good standing **loses capacity mid-contract**. This is a legal, commercial, and retention catastrophe.

Every mature pricing engine (Stripe, Chargebee, Paddle, Stigg) solves this with **plan versioning**: an edit produces a new version; existing subs are **pinned** to the version they signed; only new subs use the latest.

### Design

- Add `version: number` and `lineageId: string` to `Plan`. Editing a plan creates a new doc (new `id`, same `lineageId`, incremented `version`). The previous version is marked `isLatest: false`.
- `Subscription.planId` points at a specific version. On upgrade/downgrade/assign we always attach the **latest** version at write time.
- The superadmin UI lets you "retire" an old version (blocks new subs from picking it) without archiving the lineage.
- A migration tool (new button per-plan in `/admin/plans/{planId}`) lets the superadmin **explicitly migrate** a cohort from v1 to v2 — batched, idempotent, audit-logged. No silent drift.

### Concrete first commit

1. Shared types: add `version` and `lineageId` to `PlanSchema`; seed existing plans with `version: 1` and a fresh `lineageId`.
2. `plan.service.update()` switches from in-place edit to "create new version + mark previous non-latest."
3. Catalog read (`listCatalog`): default filter `isLatest: true`; superadmin UI has a "show history" toggle.
4. Backfill: all existing `subscriptions.planId` resolve to the v1 doc — no behavior change.

### Non-goals

- Don't rewrite legacy ordering (`sortOrder`) as version-aware — stick with per-lineage `sortOrder`.
- Don't build migration automation yet; manual migrate-cohort button is enough for v1.

### Exit criteria

- Editing `pro` creates `pro@v2`; existing pro orgs keep `pro@v1` until explicitly migrated.
- New sign-ups hit `pro@v2`.
- Audit log shows the version transition per org.

---

## 8 — Unified entitlement model · Effort: M–L

### Why second

Right now a plan has:

- `features: { qrScanning: boolean, paidTickets: boolean, ... }` — **boolean-only, 11 keys**
- `limits: { maxEvents, maxParticipantsPerEvent, maxMembers }` — **numeric-only, 3 keys**

That's rigid. We can't express:

- "Plan includes 500 SMS/month, then 25 XOF each" (metered quota)
- "API access until 2026-12-31" (time-bounded)
- "SMS pack +500 as an add-on to Starter" (additive bundle)

Every modern pricing engine converges on **one primitive**: an **entitlement**. Each entitlement key has a `kind` and metadata. Stigg calls it "features"; LaunchDarkly calls them "flags with variations"; Stripe's Billing Meters are this idea for metered specifically. The unification pays for itself the first time you ship add-ons.

### Design (sketch)

```ts
type Entitlement =
  | { kind: "boolean"; value: boolean }
  | {
      kind: "quota";
      limit: number;
      period: "month" | "cycle" | "lifetime";
      overageRateXof?: number;
    }
  | { kind: "tiered"; tiers: Array<{ upTo: number | "unlimited"; unitPriceXof: number }> };

type PlanV2 = {
  // ...existing fields
  entitlements: Record<string, Entitlement>;
  // `features` + `limits` become derived views for back-compat readers
};
```

- The resolver (`effective-plan.ts`) produces the same `EffectiveLimits` / `EffectiveFeatures` shape for current callers; new callers can read meters directly.
- Overage billing slots into place naturally once payments (Wave 6) lands.

### Concrete first commit

1. New `entitlements` field alongside the existing `features` + `limits` — **not a migration**, additive.
2. A compat layer in the resolver that synthesizes `features`/`limits` from `entitlements` when the field is present, or from the legacy fields when it's not.
3. Admin UI: new "Entitlements" tab on the plan edit form; the existing "Features" and "Limits" tabs become read-only projections of it (MVP: entitlements editor is Monaco JSON; proper UI in a follow-up).

### Non-goals

- No payment collection for overages yet (Wave 6 territory).
- No client-side metered counters yet (those require a per-tenant counter collection — defer until there's a real metered plan).

### Unlocks

- **Add-ons** (#) naturally express as extra entitlements merged into the subscription.
- **Feature flags** can piggyback on the same primitive for "beta access" to specific orgs.

---

## 9 — Billing cycle (monthly/annual) · Effort: S–M

### Why

Annual commits are industry standard for a **15–20% discount** in exchange for upfront revenue + lower churn. At our planned ARR this is a meaningful lever. Also sets the ground for Wave 6 payment collection (prepaid annual = one capture, not twelve).

### Design

- `Plan.billingCycles: Array<{ cycle: "monthly" | "annual"; priceXof: number; discountPct?: number }>` — a plan can publish one or both.
- `Subscription.billingCycle: "monthly" | "annual"` (default `"monthly"`).
- `currentPeriodEnd` math already handles arbitrary period lengths.
- UI: `/admin/plans/[planId]` edit form adds a toggle "Annual pricing" with an auto-filled 20% discount suggestion. `/organization/billing` adds a toggle on plan picker.

### Concrete first commit

1. Extend `PlanSchema.billingCycles` (optional; default monthly only).
2. `subscription.service.upgrade` accepts `{ plan, cycle? }`.
3. UI adds the annual toggle on the comparison table.

### Non-goals

- No proration on mid-cycle switches (defer to payments phase).
- No tax/VAT yet (also payments phase).

---

## 10 — Trial periods · Effort: S

### Why

The `SubscriptionStatusSchema` already has `"trialing"` as a state — unused. Shipping trials is the **single cheapest lever** for free→paid conversion we haven't pulled.

### Design

- `Plan.trialDays?: number` on the catalog.
- `upgrade()` respects `trialDays`: `status: "trialing"`, `currentPeriodEnd = now + trialDays`; after the rollover job fires at period end, sub transitions `trialing → active` (or `past_due` if payment fails).
- Billing UI: "Commencer un essai de 14 jours" CTA on the comparison table when a plan offers a trial.

### Prerequisites

- None. This is standalone and can ship before versioning if the product team wants the conversion lever before the protection lever.

---

## 11 — MRR / cohort dashboard · Effort: S–M

### Why

Today `/admin/plans` shows the catalog but answers no business question. Superadmins can't see:

- MRR by tier (and delta WoW)
- Count of orgs on each tier + orgs with active overrides (Phase 5)
- Near-limit orgs (Phase 4 gating that's about to churn)
- Trial-ending-this-week list
- Cohort migration rate (who upgraded, who downgraded, who churned)

This is **not a revenue lever by itself** — it's a **decision-making lever** that makes every other item on this list sharper. Ships fast; high leverage per hour of engineering.

### Design

- New page `/admin/plans/dashboard` or extension of the existing `/admin` landing.
- One batched query over `subscriptions` + `organizations` (both already exist with the right denormalized fields).
- Use existing recharts/UI primitives; no new dependencies.
- Refreshes every 5 minutes (React Query).

### Concrete first commit

1. New admin-service method `adminService.getPlanAnalytics()` returning the aggregate.
2. New route `GET /v1/admin/plans/analytics`.
3. New component `AdminPlanDashboard.tsx` with four cards (MRR, tier mix, near-limit, trials ending).

### Non-goals

- No historical time-series (Firestore aggregations aren't cheap; revisit when BigQuery export exists).

---

## 12 — Plan-change dry-run / impact preview · Effort: S

### Why

Before a superadmin saves a plan edit, they should see:

- _"This change will tighten `maxEvents` from 10 → 5. 4 orgs currently exceed the new limit (Acme, NGO-Dakar, …)."_
- _"Raising `priceXof` from 29 900 → 34 900 will affect 23 subscribers on `pro@v2` starting with their next billing cycle."_

This is a guardrail against the class of mistake that plan versioning (#7) prevents at runtime — it **prevents the mistake from being made in the first place**. Pair them.

### Design

- Server-side: new `POST /v1/admin/plans/:id/preview-change` endpoint accepting the proposed `UpdatePlanDto`. Runs the resolver over affected orgs, returns `{ affected: [{ orgId, name, violations: [...] }], totalCount }`.
- Client: the plan edit form shows a diff + affected-orgs summary before the Save button is enabled.

---

## 13 — Plan-level coupons · Effort: S

### Why

Event-level promo codes already exist (promo.types.ts). Plan-level ones don't. They unlock:

- Referral programs ("Get 50% off starter for 3 months if a friend signs up")
- Partner deals ("Y-Combinator 25% off year 1")
- Winback campaigns

### Design

- New `planCoupons` Firestore collection with Zod schema.
- `Subscription.couponId` slot; resolver applies the coupon's discount on top of `priceXof` for N cycles.
- Admin UI under `/admin/plans/coupons` (list/create/archive).

### Non-goals

- No self-serve coupon creation for organizers (stays platform-owned).
- No stackable coupons — one at a time per subscription.

---

## 14 — Parent-child orgs (agencies) · Effort: L

### Why

This is the **West African market differentiator**. Event agencies serving multiple NGOs/sponsors are a real segment, and the dynamic-plans work we just shipped naturally extends into a reseller model if orgs can nest.

Currently, Teranga's tenancy is flat: each org is a root. The original draft idea in Phase 0 ("plan for a group of users") dissolved into "plan for an org" by Phase 5, but if you want the "group of orgs" semantic, this is how.

### Design sketch

- Add `Organization.parentOrgId?: string`.
- New role `agency_manager` with scope `organization` on the parent. Can view/manage children.
- Billing: an agency can either (a) pay for each child independently, or (b) centralize billing on the parent (the parent's subscription covers all children). Option (b) requires a new `Subscription.coveredOrgIds: string[]` field.
- UI: a new section in `/admin/organizations` to link/unlink a parent; an "agency dashboard" view for agency managers.

### Prerequisites

- Plan versioning (#7) — enterprise deals with agencies are long-lived, and mid-contract silent edits are especially bad here.
- Entitlement model (#8) — agencies want different entitlements per child; meters are a natural fit.

### Non-goals

- No SSO across parent and children yet.
- No payout splits between agency and child — that's a payout work (Wave 6+).

---

## Cross-cutting: automated emulator-driven integration tests

Mentioned separately because it's not a feature — it's the **ground truth** that keeps every item above from silently regressing.

Proposed shape (in a follow-up PR, as you suggested):

- Vitest suite under `apps/api/src/__tests__/integration/` that boots the Firebase emulator once per test run.
- Fixtures: a small seed snapshot (2 plans, 2 orgs, 1 subscription) reloaded per test via `backfill-effective-limits`.
- Scenarios to cover on every phase:
  1. Superadmin creates a custom plan → backend + DB in sync.
  2. Superadmin assigns custom plan to org (Phase 5) → org's `effectiveLimits` reflects it immediately.
  3. Organizer hits `maxEvents` → `PlanLimitError`; raise override → can create another event.
  4. Organizer cancels → `scheduledChange` queued; fake-clock forward → rollover worker flips to free.
  5. Superadmin edits `pro.maxEvents` → Phase 7 versioning ensures existing pro org doesn't change.
- CI: a new `integration-api` job in `.github/workflows/ci.yml` that runs against the emulator.

This work pairs with this roadmap 1:1 — every phase below adds a new scenario, every regression is caught before a deploy.

---

## How to use this document

- **Product owner**: pick the next 1–2 items by ROI column and the current quarter's theme (growth vs. retention vs. B2B expansion).
- **Eng lead**: each item has a "concrete first commit" — that's where execution starts. The "non-goals" list is as important as the goals; it keeps scope honest.
- **Review cadence**: refresh this doc once per quarter or when priorities shift materially. The foundation (Phases 1-6) won't need to change; only the ordering of the menu above will.

---

## Related docs

- Original implementation plan: `/root/.claude/plans/polymorphic-jingling-hammock.md` (session-scoped plan file with full design history of Phases 1-6)
- Overall platform roadmap: `docs/delivery-plan/future-roadmap.md` (higher-level post-launch features)
- Project overview: `docs/delivery-plan/README.md`
