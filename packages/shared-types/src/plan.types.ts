import { z } from "zod";

// ─── Plan Catalog (superadmin-managed) ───────────────────────────────────────
// A Plan document is the dynamic, superadmin-editable counterpart to the
// hardcoded PLAN_LIMITS record in organization.types.ts. The hardcoded record
// remains the seed fallback and compile-time safety net for the four system
// plans (free, starter, pro, enterprise); this collection is what the runtime
// reads (in later phases) to resolve a subscription's effective limits.
//
// Every key is a stable string identifier (kebab/snake case). System plan keys
// MUST match the OrganizationPlan enum values to preserve backward
// compatibility.

const LocalizedStringSchema = z.object({
  fr: z.string().min(1).max(100),
  en: z.string().min(1).max(100),
});

const LocalizedDescriptionSchema = z.object({
  fr: z.string().min(1).max(500),
  en: z.string().min(1).max(500),
});

// Plan features — mirrors PlanFeatures in organization.types.ts.
// Declared inline here (not imported) to keep plan.types independent and to
// serialize cleanly via Zod at the API boundary.
export const PlanFeaturesSchema = z.object({
  qrScanning: z.boolean(),
  paidTickets: z.boolean(),
  customBadges: z.boolean(),
  csvExport: z.boolean(),
  smsNotifications: z.boolean(),
  advancedAnalytics: z.boolean(),
  speakerPortal: z.boolean(),
  sponsorPortal: z.boolean(),
  apiAccess: z.boolean(),
  whiteLabel: z.boolean(),
  promoCodes: z.boolean(),
});

// Numeric plan limits — Infinity is represented as the literal number in JSON
// via the `unlimited` marker (`-1`) to survive serialization. The API
// translates -1 ⇄ Infinity at the repository boundary.
const LIMIT_UNLIMITED = -1;
export const PLAN_LIMIT_UNLIMITED = LIMIT_UNLIMITED;

const PlanLimitValueSchema = z
  .number()
  .int()
  .refine((v) => v === LIMIT_UNLIMITED || v >= 0, {
    message: "La limite doit être >= 0 ou -1 (illimité)",
  });

export const PlanLimitsValueSchema = z.object({
  maxEvents: PlanLimitValueSchema,
  maxParticipantsPerEvent: PlanLimitValueSchema,
  maxMembers: PlanLimitValueSchema,
});

// ─── Pricing model ──────────────────────────────────────────────────────────
// Disambiguates the meaning of `priceXof: 0`. Without this, a free plan and
// an enterprise "contact sales" plan both render as "Gratuit" in the UI.
//
//  - "free":    truly free, no charge, no quote. priceXof MUST be 0.
//  - "fixed":   flat recurring price. priceXof is the amount charged per
//               billing cycle.
//  - "custom":  quote on request / contact sales. priceXof is ignored by
//               the UI (renders as "Sur devis"). Typical for enterprise
//               contracts that are negotiated individually.
//  - "metered": base fee + usage overage. priceXof is the base fee; overage
//               rates live on the plan's entitlement meters (Phase 5+).
export const PricingModelSchema = z.enum(["free", "fixed", "custom", "metered"]);
export type PricingModel = z.infer<typeof PricingModelSchema>;

export const PlanSchema = z.object({
  id: z.string(),
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, "La clé doit être en minuscules, alphanumérique"),
  name: LocalizedStringSchema,
  description: LocalizedDescriptionSchema.nullable().optional(),
  pricingModel: PricingModelSchema.default("fixed"),
  priceXof: z.number().int().min(0),
  // ── Annual billing (Phase 7+ item #3) ────────────────────────────────────
  // `priceXof` above is the MONTHLY price. When this field is set, the plan
  // also offers an annual cycle at the given total-year price (typically 15-
  // 20% cheaper than priceXof × 12). When null/undefined, only monthly is
  // offered. Only meaningful for pricingModel === "fixed".
  //
  // The monthly↔annual savings are displayed to users as the implicit
  // difference (priceXof × 12 − annualPriceXof); storing two explicit prices
  // keeps the arithmetic trivial and the rounding intuitive (no "XOF 2871.6"
  // edge cases from percentage math).
  annualPriceXof: z.number().int().min(0).nullable().optional(),
  currency: z.literal("XOF").default("XOF"),
  limits: PlanLimitsValueSchema,
  features: PlanFeaturesSchema,
  isSystem: z.boolean().default(false),
  isPublic: z.boolean().default(true),
  isArchived: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  // ── Trial periods (Phase 7+ item #4) ──────────────────────────────────────
  // When set (> 0), a first-time upgrade from a non-paying org onto this plan
  // starts a trial: subscription.status = "trialing", priceXof is suspended
  // until the trial expires, and a scheduledChange with reason="trial_ended"
  // is queued so the daily rollover worker flips status → "active" at
  // `currentPeriodStart + trialDays`. 0 / missing = no trial.
  trialDays: z.number().int().min(0).max(365).nullable().optional(),
  // ── Versioning (Phase 7) ───────────────────────────────────────────────────
  // `lineageId` groups every version of the same logical plan (e.g. every
  // generation of "pro"). `version` increments on each edit. `isLatest` is the
  // mutable flag the catalog reader filters by — only the latest version of a
  // lineage appears in the public catalog or on newly-assigned subscriptions.
  // `previousVersionId` breadcrumbs the version chain so the admin UI can
  // render a history timeline.
  //
  // Backward-compat: these fields are optional. Plans created before Phase 7
  // rely on a one-time backfill to stamp `version: 1 / isLatest: true` with a
  // fresh `lineageId`. The catalog readers treat "missing isLatest" as "true"
  // during the migration window.
  version: z.number().int().min(1).default(1),
  lineageId: z.string(),
  isLatest: z.boolean().default(true),
  previousVersionId: z.string().nullable().optional(),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Plan = z.infer<typeof PlanSchema>;

// ─── Create / Update DTOs ────────────────────────────────────────────────────

export const CreatePlanSchema = z
  .object({
    key: PlanSchema.shape.key,
    name: LocalizedStringSchema,
    description: LocalizedDescriptionSchema.nullable().optional(),
    pricingModel: PricingModelSchema.default("fixed"),
    priceXof: z.number().int().min(0),
    annualPriceXof: z.number().int().min(0).nullable().optional(),
    limits: PlanLimitsValueSchema,
    features: PlanFeaturesSchema,
    isPublic: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
    trialDays: z.number().int().min(0).max(365).nullable().optional(),
  })
  .refine((v) => !(v.pricingModel === "free" && v.priceXof > 0), {
    message: "Un plan 'free' ne peut pas avoir de priceXof > 0",
    path: ["priceXof"],
  })
  .refine((v) => !(v.pricingModel === "fixed" && v.priceXof <= 0), {
    message: "Un plan 'fixed' doit avoir un priceXof > 0",
    path: ["priceXof"],
  });

export type CreatePlanDto = z.infer<typeof CreatePlanSchema>;

// System plans protect `key` and `isSystem`; everything else is editable.
export const UpdatePlanSchema = z
  .object({
    name: LocalizedStringSchema,
    description: LocalizedDescriptionSchema.nullable(),
    pricingModel: PricingModelSchema,
    priceXof: z.number().int().min(0),
    annualPriceXof: z.number().int().min(0).nullable(),
    limits: PlanLimitsValueSchema,
    features: PlanFeaturesSchema,
    isPublic: z.boolean(),
    isArchived: z.boolean(),
    sortOrder: z.number().int(),
    trialDays: z.number().int().min(0).max(365).nullable(),
  })
  .partial();

export type UpdatePlanDto = z.infer<typeof UpdatePlanSchema>;

// ─── Subscription Override (Phase 2 — declared now for API contract stability) ──

export const SubscriptionOverridesSchema = z.object({
  limits: PlanLimitsValueSchema.partial().optional(),
  features: PlanFeaturesSchema.partial().optional(),
  priceXof: z.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

export type SubscriptionOverrides = z.infer<typeof SubscriptionOverridesSchema>;

// ─── Scheduled Plan Change (Phase 4c) ──────────────────────────────────────
// Represents a plan transition scheduled to take effect at a specific point
// in time (usually the end of the current paid billing period). Honors the
// "prepaid rights survive a downgrade" principle: a user who paid for Pro
// through 2026-12-31 keeps Pro until that date even after they hit
// "downgrade", matching Stripe's `cancel_at_period_end` model.
//
// Written by subscription.service.downgrade() / .cancel() when a paid
// period is still in force. Consumed by a daily rollover Cloud Function
// that flips the subscription + re-denormalizes org.effectiveLimits at or
// after `effectiveAt`.
export const ScheduledChangeReasonSchema = z.enum([
  "downgrade", // user-initiated downgrade to a lower tier
  "cancel", // user-initiated cancellation (target = "free")
  "admin_override", // superadmin scheduled an override to land at period end
  "plan_archived", // catalog plan archived; scheduled migration to a fallback
  "trial_ended", // trial period completed; flip status trialing → active (plan unchanged)
]);
export type ScheduledChangeReason = z.infer<typeof ScheduledChangeReasonSchema>;

export const ScheduledChangeSchema = z.object({
  // Target plan — both the legacy enum key (for backward-compat reads) and
  // the catalog id (for the forward-looking resolver path).
  toPlan: z.string(), // OrganizationPlan enum value or custom plan key
  toPlanId: z.string().optional(),
  toPlanOverrides: SubscriptionOverridesSchema.optional(),
  effectiveAt: z.string().datetime(),
  reason: ScheduledChangeReasonSchema,
  scheduledBy: z.string(),
  scheduledAt: z.string().datetime(),
  // Free-text note surfaced in UI/audit (e.g. "downgrade to free — user
  // opted out of paid tier").
  note: z.string().max(500).optional(),
});

export type ScheduledChange = z.infer<typeof ScheduledChangeSchema>;

// ─── Assign Plan DTO (Phase 5 — admin per-org override) ────────────────────
// Payload for POST /v1/admin/organizations/:orgId/subscription/assign.
// Replaces the "cleaner" upgrade/downgrade paths with a superadmin-only
// mutation that accepts any catalog plan and optional per-subscription
// overrides. Carries the same contract as `Subscription.overrides` so the
// resolver can merge them identically.
export const AssignPlanSchema = z.object({
  planId: z.string().min(1),
  overrides: SubscriptionOverridesSchema.optional(),
});

export type AssignPlanDto = z.infer<typeof AssignPlanSchema>;

// ─── Plan-change dry-run / impact preview (Phase 7+ item #6) ──────────────
// Payload for POST /v1/admin/plans/:id/preview-change. Lets a superadmin
// see *which* organisations would violate the new limits before pressing
// Save — pairs with Phase 7 versioning (which prevents silent retightening
// at runtime) by catching the mistake at compose-time instead.
//
// Scope (per the Phase 7+ roadmap §12 non-goals):
//   - Only version-material changes trigger a real scan. Display-only
//     edits (sortOrder, isPublic) short-circuit with `willMintNewVersion:
//     false, affected: []`.
//   - The scan walks every subscription pinned to ANY version in the same
//     lineage (not just the current latest) — a superadmin editing pro@v2
//     still wants to see the v1 grandfathers they'd affect if they
//     migrated them later.
//   - `maxParticipantsPerEvent` violations are NOT previewed (would
//     require a per-event usage scan). Other limits (maxEvents,
//     maxMembers) + feature removals are previewed.

export const PreviewAffectedOrgSchema = z.object({
  orgId: z.string(),
  name: z.string(),
  // The plan version this org's subscription is currently pinned to. Lets
  // the UI say "3 affected on v1, 5 on v2".
  currentVersion: z.number().int(),
  // Whether the org is currently trialing — lets the UI soften the wording
  // ("will apply when they convert").
  isTrialing: z.boolean(),
  billingCycle: z.enum(["monthly", "annual"]).nullable(),
  // Human-readable French strings, one per violation. Empty array means
  // the org is pinned to this lineage but the change wouldn't break them
  // (e.g. a feature they don't use was removed). The UI still lists them
  // grouped by version so the admin can see the cohort size.
  violations: z.array(z.string()),
});

export type PreviewAffectedOrg = z.infer<typeof PreviewAffectedOrgSchema>;

export const PreviewChangeResponseSchema = z.object({
  willMintNewVersion: z.boolean(),
  totalScanned: z.number().int(),
  totalAffected: z.number().int(),
  affected: z.array(PreviewAffectedOrgSchema),
});

export type PreviewChangeResponse = z.infer<typeof PreviewChangeResponseSchema>;

// ─── Query / Listing ─────────────────────────────────────────────────────────

export const PlanListQuerySchema = z.object({
  includeArchived: z
    .preprocess((v) => (v === "true" || v === true ? true : false), z.boolean())
    .optional(),
  onlyPublic: z
    .preprocess((v) => (v === "true" || v === true ? true : false), z.boolean())
    .optional(),
});

export type PlanListQuery = z.infer<typeof PlanListQuerySchema>;
