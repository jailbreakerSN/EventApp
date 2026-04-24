# Plan revenue levers — A1 + A2 + B1

**Status:** Planned — implementation in progress on `claude/plan-revenue-levers`.
**Scope:** Three sequential features on the plan-management + events surfaces.

---

## A1 — Per-org entitlement overrides

**Goal:** close the scope cut from PR #185 foundation. Re-introduce
`SubscriptionOverridesSchema.entitlements` so a super-admin can override
entitlements on a specific organization (e.g. "grant SMS pack to Sonatel
for 90 days").

### Design decisions

- **Loose Zod shape at the schema boundary.** Mirroring
  `OrganizationSchema.effectiveEntitlements` (landed in PR #185), the
  field is typed as `z.record(z.string(), z.unknown()).optional()`.
  This keeps the contract snapshot small and avoids the massive
  discriminated-union expansion that blocked the foundation PR's CI.
- **Strict validation happens at the service layer.** The
  `AssignPlanDialog` form + admin route both run
  `EntitlementMapSchema.safeParse(overrides.entitlements)` before
  persisting; malformed payloads are rejected with the standard Zod
  error path.
- **Resolver precedence:** plan entitlements → legacy overrides →
  entitlement overrides (entitlement overrides win on collision).
  The merged entitlement map is populated from all three layers for
  hot-path readers.
- **Admin UI:** extend `AssignPlanDialog` with a JSON textarea
  (same MVP pattern as `PlanForm`'s entitlements editor), client-side
  validated against `EntitlementMapSchema`.

### Files touched

- `packages/shared-types/src/plan.types.ts` — add optional
  `entitlements` on `SubscriptionOverridesSchema`.
- `apps/api/src/services/effective-plan.ts` — add Step 3 in the
  merge pipeline for override entitlements + sync the merged map.
- `apps/api/src/services/subscription.service.ts` — validate the
  override entitlement map with the strict schema before passing to
  the resolver; reject on malformed JSON.
- `apps/web-backoffice/src/components/admin/AssignPlanDialog.tsx` —
  JSON editor + Zod validation on submit.
- Tests: extend `effective-plan.test.ts` with override-entitlements
  cases.

---

## A2 — Plan-level coupons

**Goal:** support promo campaigns + partner deals on plan upgrades.
Distinct from the existing event-scoped `promoCodes` collection —
plan coupons target subscription upgrades, not ticket purchases.

### Schema

```ts
export const PlanCouponSchema = z.object({
  id: z.string(),
  code: z.string().min(3).max(50).regex(/^[A-Z0-9_-]+$/),  // uppercase convention
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.number().positive(),      // 1..100 for %, XOF for fixed
  // Scope — null means "applies to every plan"; populated array whitelists
  // specific planIds (by `plans/{id}` doc id, not the enum key — coupons
  // bind to a specific plan VERSION so grandfathering holds).
  appliedPlanIds: z.array(z.string()).nullable(),
  // Cycle scope — optional; when set, coupon only applies to that cycle.
  appliedCycles: z.array(z.enum(["monthly", "annual"])).nullable(),
  // Usage caps — both aggregate and per-org caps supported.
  maxUses: z.number().int().positive().nullable(),      // global cap
  maxUsesPerOrg: z.number().int().positive().nullable(), // dedup orgs
  usedCount: z.number().int().nonnegative().default(0),
  // Validity window.
  startsAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  isActive: z.boolean().default(true),
  // Audit.
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

### Validation rules (at apply-time, inside upgrade transaction)

1. `isActive === true` AND `now` within `[startsAt, expiresAt]` window.
2. `appliedPlanIds` empty (null) OR target planId in array.
3. `appliedCycles` empty (null) OR target cycle in array.
4. `maxUses` not exceeded (aggregate).
5. `maxUsesPerOrg` not exceeded for this org (query
   `couponRedemptions` collection).
6. Org is not on the free tier (can't "upgrade to free" — the
   upgrade endpoint already rejects `"free"` as a target).

### Redemption record

New `couponRedemptions` collection for audit + per-org cap enforcement:

```ts
{
  id, couponId, organizationId, subscriptionId, planId, cycle,
  discountAppliedXof, originalPriceXof, finalPriceXof,
  redeemedBy, redeemedAt
}
```

### Upgrade flow integration

- `UpgradePlanSchema` gains `couponCode?: string`.
- Inside `subscription.service.upgrade()`, after plan lookup:
  1. If `couponCode` present, fetch coupon by code (indexed).
  2. Validate against rules above.
  3. Compute `finalPriceXof` from base + discount (integer XOF math).
  4. Apply in the transaction: increment `coupon.usedCount`, write
     `couponRedemptions` doc, write `subscription.appliedCoupon`
     field.
  5. Emit `subscription.upgraded` with extended payload.

### Routes

- **Admin (platform:manage):**
  - `POST /v1/admin/coupons` — create
  - `GET /v1/admin/coupons?planId=...&isActive=...` — list
  - `GET /v1/admin/coupons/:couponId` — detail + redemptions
  - `PATCH /v1/admin/coupons/:couponId` — update (toggle active, change caps)
  - `DELETE /v1/admin/coupons/:couponId` — soft delete (sets `isActive: false`)
- **Public auth (organization:manage_billing):**
  - `POST /v1/plans/:planId/validate-coupon` — dry-run: returns
    discount preview + final price. Zero side effect.

### UI surfaces

- **Admin:** `/admin/coupons` CRUD page, sidebar entry under Billing.
- **Billing (participant backoffice):** coupon input field on the
  upgrade plan card. Debounced validate on blur → show inline
  "–2,000 XOF applied" / error state.

### Files touched

- `packages/shared-types/src/plan-coupon.types.ts` (new)
- `packages/shared-types/src/subscription.types.ts` — extend
  `UpgradePlanSchema` with `couponCode`; extend `SubscriptionSchema`
  with `appliedCoupon?: { couponId; code; discountXof }` nullable.
- `apps/api/src/repositories/plan-coupon.repository.ts` (new)
- `apps/api/src/repositories/coupon-redemption.repository.ts` (new)
- `apps/api/src/services/plan-coupon.service.ts` (new)
- `apps/api/src/services/subscription.service.ts` — hook coupon into
  upgrade flow inside the existing transaction.
- `apps/api/src/routes/plan-coupons.routes.ts` (new)
- `apps/api/src/routes/subscriptions.routes.ts` — already validates
  `UpgradePlanSchema`; schema extension auto-applies.
- `apps/api/src/events/domain-events.ts` — extend
  `subscription.upgraded` payload shape.
- `apps/web-backoffice/src/app/(admin)/admin/coupons/page.tsx` (new)
- `apps/web-backoffice/src/app/(admin)/admin/coupons/[couponId]/page.tsx` (new)
- `apps/web-backoffice/src/app/(dashboard)/organization/billing/page.tsx` —
  coupon input on the upgrade dialog.
- Firestore indexes: `couponRedemptions (organizationId, couponId)` +
  `planCoupons (code)` (for code lookup).
- Tests: unit + integration for validation / race / apply paths.

---

## B1 — Recurring events

**Goal:** support events that repeat (weekly workshops, monthly
meetups, conference series). Demand signal: every multi-event
organizer currently clones events manually.

### Design: parent + children

Rejected alternative: virtual occurrences (single doc, expand at
read). Reasons to pick parent+children:

- Registrations are per-occurrence today; virtual occurrences would
  force a schema migration of the registration aggregate.
- Participant discovery works today via plain Event queries — each
  occurrence is a first-class Event doc searchable by date/location.
- Per-occurrence admin actions (cancel one week without touching
  others) fall out for free.
- Plan quota math stays honest: each occurrence counts against
  `maxEvents` — organizer sees the real cost of a series.

### Schema additions

On `EventSchema`:

```ts
isRecurringParent: z.boolean().default(false),
recurrenceRule: z.object({
  freq: z.enum(["daily", "weekly", "monthly"]),   // no yearly in MVP
  interval: z.number().int().positive().default(1),
  byDay: z.array(z.enum(["MO","TU","WE","TH","FR","SA","SU"])).optional(),
  byMonthDay: z.array(z.number().int().min(1).max(31)).optional(),
  until: z.string().datetime().nullable().optional(),
  count: z.number().int().positive().max(52).nullable().optional(),
}).nullable().optional(),
parentEventId: z.string().nullable().optional(),
occurrenceIndex: z.number().int().nonnegative().nullable().optional(),
```

### Occurrence generation — pure function, no rrule.js dep

```ts
export function generateOccurrences(
  startDate: string, endDate: string,
  rule: RecurrenceRule, timezone: string,
): Array<{ startDate: string; endDate: string; index: number }>
```

- Walk dates in the event's `timezone` (not UTC) so "every Monday"
  means local-Monday.
- Stop at `until` or `count` — MVP caps at 52 occurrences (weekly for
  a year) to keep quota enforcement legible.
- Return occurrences in chronological order with stable indexes.

### Create flow

In `event.service.create`:

1. If `dto.recurrenceRule` absent: unchanged (single-event path).
2. If present:
   a. Compute occurrences with `generateOccurrences`.
   b. Enforce plan quota against `currentEventCount + occurrences.length`.
   c. Create parent event (status=`draft`, `isRecurringParent=true`)
      + N child events (each a full Event doc with `parentEventId`).
   d. Run in `db.runTransaction` so partial failure doesn't leave
      dangling children.
   e. Batch-write up to 500 per txn; split if > 500.
   f. Emit `event.series_created` with payload
      `{ parentEventId, occurrenceCount, actorId }`.

### Participant listing

- Parent events are **hidden by default** in public event search:
  `venueService.listPublic` + `eventService.listPublic` already
  filter by `status: "published"`; parents stay as `draft` until the
  organizer publishes the series (publishing propagates to children
  in one transaction).
- Add safety filter: explicit `isRecurringParent !== true` clause
  when listing for the public surface.

### Series publishing

New endpoint: `POST /v1/events/:parentEventId/publish-series`. Finds
all children with `parentEventId === parent.id`, publishes each
atomically, emits one `event.series_published` event.

### Files touched

- `packages/shared-types/src/event.types.ts` — schema additions.
- `apps/api/src/services/event.service.ts` — recurrence branch in
  `create`, plus `publishSeries`.
- `apps/api/src/services/recurrence.service.ts` (new) — pure
  `generateOccurrences` helper + tests.
- `apps/api/src/routes/events.routes.ts` — new `publish-series`
  route.
- `apps/web-backoffice/src/app/(dashboard)/events/new/page.tsx` —
  recurrence section in the create form.
- `apps/web-backoffice/src/app/(dashboard)/events/[eventId]/page.tsx` —
  "Cette série contient N occurrences" banner on the parent event
  edit page.
- `apps/web-participant/src/app/(public)/events/[slug]/page.tsx` —
  child event page shows a "Autres dates de cette série" sidebar.
- Firestore indexes:
  `events (parentEventId, startDate)`,
  `events (isRecurringParent, organizationId, createdAt DESC)`.
- Tests: unit for `generateOccurrences`, integration for
  create-with-recurrence, cancel-one-occurrence, publish-series.

---

## Sequencing

- **PR #1 — A1 + A2** (Semaine 1)
- **PR #2 — B1** (Semaine 2)
- **Deferred to follow-ups:** admin coupon analytics (redemption
  funnel), per-occurrence cancellation UX polish, waitlist B2.

Each PR ships with its own design-doc section (pointing to this file),
rigorous self-review (agent-driven), full test suite green before
merge.
