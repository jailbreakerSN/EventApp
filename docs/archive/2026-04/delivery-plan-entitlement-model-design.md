# Unified Entitlement Model — Design

**Status:** Proposed (first commit on `claude/entitlement-model`)
**Wave:** Plan-Management Phase 7+ item #2 (see `./plan-management-phase-7-plus.md` §8)
**Scope:** Foundation-only. Payment collection, metered counters, and the tiered
resolver are deferred to follow-ups (listed under "Non-goals" below).

---

## Problem

The current plan catalog uses two orthogonal primitives:

- `features: Record<PlanFeature, boolean>` — 11 hard-coded boolean keys
- `limits: { maxEvents, maxParticipantsPerEvent, maxMembers }` — 3 numeric keys

That shape can't express a growing set of real pricing cases:

- Metered quotas ("500 SMS / month included, 25 XOF per SMS over that")
- Time-bounded entitlements ("API access until 2026-12-31")
- Add-ons ("+500 SMS pack on Starter")
- Per-org feature-flag overrides ("beta checkin flow for org X")

Every SaaS billing engine (Stigg, LaunchDarkly, Stripe Billing Meters) converges on
a single primitive: the **entitlement**. We ship that primitive now so the next four
revenue-lever items (#7 coupons, #8 agency billing, add-ons, metered SMS) land
without a second schema migration.

---

## Core primitive

```ts
type Entitlement =
  | { kind: "boolean"; value: boolean }
  | {
      kind: "quota";
      limit: number; // -1 = unlimited, same convention as PlanLimits
      period: "month" | "cycle" | "lifetime";
      overageRateXof?: number; // optional — unused in MVP, reserved for metered billing
    }
  | {
      kind: "tiered";
      tiers: Array<{ upTo: number | "unlimited"; unitPriceXof: number }>;
    };

type Plan = {
  // ...existing fields
  entitlements?: Record<string, Entitlement>;
};
```

### Key naming convention

Entitlement keys are **namespaced by kind family**:

- `feature.<name>` — boolean. One per existing `PlanFeatures` key:
  `feature.qrScanning`, `feature.paidTickets`, `feature.customBadges`,
  `feature.csvExport`, `feature.smsNotifications`,
  `feature.advancedAnalytics`, `feature.speakerPortal`,
  `feature.sponsorPortal`, `feature.apiAccess`, `feature.whiteLabel`,
  `feature.promoCodes`.
- `quota.<name>` — quota. `quota.events`, `quota.participantsPerEvent`,
  `quota.members` for parity with legacy limits; new quotas land under the
  same family: `quota.sms.monthly`, `quota.api.dailyRequests`, etc.
- `tiered.<name>` — reserved. Schema-only in this PR; resolver support lands
  with #7 (coupons) or the first metered-billing PR.

Rationale: a prefix avoids collisions ("events" the feature vs "events" the
quota) and lets the resolver route by family without a manifest.

---

## Back-compat — the additive contract

The whole point of this PR is to ship entitlements without touching any of the
14 existing enforcement sites (`requirePlanFeature` / `checkPlanLimit` callers)
or the 6 integration tests that assert on `org.effectiveLimits` /
`org.effectiveFeatures`. We achieve that by:

### 1. Entitlements are **opt-in per plan**

- When `plan.entitlements` is undefined: resolver reads `plan.features` +
  `plan.limits` exactly like today. This is the path the four system plans
  (free/starter/pro/enterprise) and every Phase 7-era plan take. No
  behavioural change for them.
- When `plan.entitlements` is defined: resolver projects `features` and
  `limits` views from the entitlement map **and** continues to honour any
  legacy overrides. Downstream readers (enforcement, denormalization, UI)
  consume the same projected shape they consume today.

### 2. The resolver output shape is unchanged

```ts
interface EffectivePlan {
  planKey: string;
  planId: string;
  limits: { maxEvents; maxParticipantsPerEvent; maxMembers }; // projected
  features: PlanFeatures; // projected, all 11 keys
  priceXof: number;
  computedAt: string;
  entitlements?: Record<string, Entitlement>; // NEW — opaque passthrough
}
```

The new `entitlements` field is optional and opaque to legacy readers. The
existing `features` + `limits` fields are always populated — projected from
entitlements when present, read from plan fields otherwise. No call site needs
to change.

### 3. Denormalization gains one optional field

`Organization.effectiveEntitlements?: Record<string, Entitlement>` is written
alongside the existing `effectiveLimits` / `effectiveFeatures` / `effectivePlanKey`
/ `effectiveComputedAt` fields on denorm. Legacy enforcement reads the
existing fields; new helpers (`requireEntitlement`, `checkQuota`) prefer the
new field when set.

### 4. Subscription overrides layer on top

`SubscriptionOverrides.entitlements?: Record<string, Entitlement>` is an
additional per-key override. Merge order in `resolveEffective`:

1. Start from `plan.entitlements` (if any) or project from
   `plan.features`/`plan.limits`.
2. Overlay `overrides.entitlements` per key (new path).
3. Overlay `overrides.features` / `overrides.limits` per field (legacy path)
   by reprojecting into entitlement space.
4. Project back to `features` + `limits` for the output shape.

---

## New enforcement helpers on `BaseService`

Two quota-aware helpers, living next to the existing `requirePlanFeature` /
`checkPlanLimit`:

```ts
// Boolean check against an entitlement key. Falls back to the legacy
// `requirePlanFeature` when the org has no `effectiveEntitlements` but the
// feature key maps to one of the 11 legacy `PlanFeature` keys.
protected requireEntitlement(org: Organization, key: string): void;

// Quota check. Reads `org.effectiveEntitlements[key]` if kind === "quota",
// else falls back to `checkPlanLimit` for the three pre-defined resources.
// Returns the same `{ allowed, current, limit }` shape.
protected checkQuota(
  org: Organization,
  key: string,
  current: number,
): { allowed: boolean; current: number; limit: number };
```

The existing 14 enforcement call sites stay on `requirePlanFeature` /
`checkPlanLimit`. New callers (SMS packs, API rate-limits, add-ons) use the
new helpers directly.

---

## Admin UI — MVP only

Per the roadmap doc's "MVP: entitlements editor is Monaco JSON; proper UI in
a follow-up":

- `/admin/plans/[planId]` gains an **"Entitlements (avancé)"** section under
  the existing form.
- The section is a textarea + Zod-validated JSON blob. Paste /
  copy / review — no React form scaffolding.
- For plans that don't use entitlements, the section is empty and the
  existing features/limits toggles stay authoritative.
- For plans that **do** use entitlements, the features/limits toggles render
  as a **read-only projection** with a warning banner: "Ce plan utilise le
  modèle unifié d'entitlements. Modifiez le JSON ci-dessous."

No new dependency on Monaco Editor in this PR — a textarea is enough for a
super-admin-only surface. A proper entitlement builder is a follow-up.

---

## Non-goals (in this PR)

Explicitly deferred, with owning follow-up:

- **Payment collection for overages** — Wave 6 (payments phase).
- **Client-side metered counters** — the per-tenant counter collection lands
  with the first real metered plan.
- **Tiered resolver** — schema accepts `kind: "tiered"` but the resolver
  treats it as unprojected; UI shows a warning. First real use-case wires
  the resolver.
- **Migration of system plans to entitlements** — the four system plans
  (free / starter / pro / enterprise) stay on the legacy path. Opt-in per
  plan via admin edit.
- **Feature-flag piggyback** — the per-org feature-flag story (plan doc
  §8 "Unlocks") lands in a dedicated PR once the entitlement primitive is
  merged and the team has chosen the cross-scope merge semantics.

---

## Testing strategy

### Unit tests (shared-types)

- `EntitlementSchema` — accepts each `kind`, rejects unknown kinds /
  malformed discriminants.
- `projectFromEntitlements(entitlements)` pure-function — given the 11
  known feature keys as `feature.*` entitlements, produces the same
  `PlanFeatures` object as the legacy path.

### Unit tests (API)

- `resolveEffective` — parity test: a plan with entitlements produces the
  same `EffectivePlan.features` + `.limits` as an equivalent legacy plan.
- `resolveEffective` — fallback test: a plan without entitlements still
  resolves via the legacy path unchanged.
- `resolveEffective` — override merge: `overrides.entitlements` wins over
  plan entitlements; legacy overrides still apply when entitlements are
  absent.
- `requireEntitlement` / `checkQuota` — happy path + fallback to legacy
  helpers when entitlements are absent.

### Integration tests

Not required in this PR — the 6 existing integration tests (`assign-plan`,
`event-limit`, `unlimited-plan-fallback`, `plan-versioning`, `trial-enrolment`,
`scheduled-rollover`) already assert on the denormalized shape. They **must
stay green** without modification, which is the primary proof that the
additive contract holds.

### Contract snapshots

The shared-types contract snapshots will grow by ~30 lines (the new
`EntitlementSchema` discriminated union + the optional `entitlements` /
`effectiveEntitlements` fields). No breaking changes.

---

## Sequencing

1. shared-types: `EntitlementSchema`, extend `PlanSchema` +
   `SubscriptionOverridesSchema` + `OrganizationSchema`.
2. API resolver: `projectFromEntitlements` + update `resolveEffective` to
   prefer entitlements when present.
3. API enforcement: add `requireEntitlement` + `checkQuota` on `BaseService`.
4. Denormalization: `subscription.service` writes `effectiveEntitlements`;
   `backfill-effective-limits.ts` handles the new field.
5. Admin UI: entitlements section on plan edit form.
6. Tests: unit coverage for resolver + helpers; contract snapshot refresh.
7. Rigorous self-review → fix findings → open PR.

Each step ships behind zero feature flag — the primitive is dormant until a
plan opts in by setting `entitlements`. The four system plans stay on the
legacy path; opt-in is a deliberate super-admin choice per custom plan.
