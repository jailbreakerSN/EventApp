import { z } from "zod";
import { BillingCycleSchema } from "./subscription.types";

// ─── Plan Coupons (Phase 7+ item #7) ──────────────────────────────────────
//
// Promo campaign primitive for subscription UPGRADES. Distinct from
// `PromoCodeSchema` (event.types + promo.types) which is event-scoped
// (applies to ticket purchases on a single event). Plan coupons bind
// to specific plan VERSIONS (by `plans/{id}` doc id, not the enum key)
// so a grandfathered coupon stays attached to its plan lineage as new
// versions ship.
//
// Redemption flow:
//   1. Super-admin creates coupon via `/admin/coupons` (code unique
//      global, uppercase convention `TERANGA_LAUNCH2026`).
//   2. Org admin pastes code into the billing upgrade dialog.
//   3. Web backoffice pre-validates via `/plans/:planId/validate-coupon`
//      (dry-run, zero side effect; shows discount preview).
//   4. On submit, `/organizations/:orgId/subscription/upgrade` re-runs
//      validation inside the existing transaction — increments
//      `usedCount`, writes a `couponRedemptions` doc, stores the
//      applied coupon on the subscription.
//
// Every check is transaction-safe: global cap + per-org cap both
// consult Firestore inside the upgrade transaction so two concurrent
// upgrades can't over-redeem a capped coupon.

export const CouponDiscountTypeSchema = z.enum(["percentage", "fixed"]);
export type CouponDiscountType = z.infer<typeof CouponDiscountTypeSchema>;

// Code convention: uppercase + digits + `_` / `-`, 3..50 chars. Rejecting
// mixed-case at the schema boundary keeps the Firestore lookup index
// case-insensitive without any runtime normalisation magic downstream.
export const PlanCouponCodeSchema = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[A-Z0-9_-]+$/, "Le code doit être en majuscules, alphanumérique (incl. _ et -).");

export const PlanCouponSchema = z.object({
  id: z.string(),
  code: PlanCouponCodeSchema,
  // Short human label for the admin dashboard (not shown to customers).
  label: z.string().max(200).nullable(),
  discountType: CouponDiscountTypeSchema,
  // For `percentage`: 1..100 (integer). For `fixed`: positive XOF amount.
  // Both constraints enforced by the create schema's refinement below.
  discountValue: z.number().int().positive(),
  // Scope — null / empty means "applies to every plan". Populated array
  // whitelists specific `plans/{id}` ids. Binds to VERSION, not lineage,
  // so editing a plan mints a new version that's untouched by old coupons
  // unless the super-admin explicitly adds the new plan id.
  appliedPlanIds: z.array(z.string()).nullable(),
  // null / empty means "applies to every cycle". Populated array
  // whitelists monthly / annual.
  appliedCycles: z.array(BillingCycleSchema).nullable(),
  // Usage caps.
  maxUses: z.number().int().positive().nullable(),
  maxUsesPerOrg: z.number().int().positive().nullable(),
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

export type PlanCoupon = z.infer<typeof PlanCouponSchema>;

// ─── Create / Update DTOs ────────────────────────────────────────────────

export const CreatePlanCouponSchema = z
  .object({
    code: PlanCouponCodeSchema,
    label: z.string().max(200).nullable().optional(),
    discountType: CouponDiscountTypeSchema,
    discountValue: z.number().int().positive(),
    appliedPlanIds: z.array(z.string()).nullable().optional(),
    appliedCycles: z.array(BillingCycleSchema).nullable().optional(),
    maxUses: z.number().int().positive().nullable().optional(),
    maxUsesPerOrg: z.number().int().positive().nullable().optional(),
    startsAt: z.string().datetime().nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((v) => !(v.discountType === "percentage" && v.discountValue > 100), {
    message: "Le pourcentage doit être entre 1 et 100.",
    path: ["discountValue"],
  })
  .refine(
    (v) => !(v.startsAt && v.expiresAt && new Date(v.startsAt) >= new Date(v.expiresAt)),
    {
      message: "`startsAt` doit précéder `expiresAt`.",
      path: ["expiresAt"],
    },
  );

export type CreatePlanCouponDto = z.infer<typeof CreatePlanCouponSchema>;

export const UpdatePlanCouponSchema = z
  .object({
    label: z.string().max(200).nullable(),
    appliedPlanIds: z.array(z.string()).nullable(),
    appliedCycles: z.array(BillingCycleSchema).nullable(),
    maxUses: z.number().int().positive().nullable(),
    maxUsesPerOrg: z.number().int().positive().nullable(),
    startsAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    isActive: z.boolean(),
  })
  .partial();

export type UpdatePlanCouponDto = z.infer<typeof UpdatePlanCouponSchema>;

// ─── Validate-coupon request/response ────────────────────────────────────

export const ValidateCouponRequestSchema = z.object({
  code: PlanCouponCodeSchema,
  cycle: BillingCycleSchema.optional(),
});
export type ValidateCouponRequest = z.infer<typeof ValidateCouponRequestSchema>;

export const ValidateCouponResponseSchema = z.object({
  valid: z.literal(true),
  couponId: z.string(),
  code: z.string(),
  discountType: CouponDiscountTypeSchema,
  discountValue: z.number().int().positive(),
  // Dry-run computed fields (post-discount). XOF rounded to integer.
  originalPriceXof: z.number().int().nonnegative(),
  discountXof: z.number().int().nonnegative(),
  finalPriceXof: z.number().int().nonnegative(),
});
export type ValidateCouponResponse = z.infer<typeof ValidateCouponResponseSchema>;

// ─── Coupon Redemption — audit trail ─────────────────────────────────────

export const CouponRedemptionSchema = z.object({
  id: z.string(),
  couponId: z.string(),
  couponCode: z.string(), // denormalised for convenient reads
  organizationId: z.string(),
  subscriptionId: z.string(),
  planId: z.string(),
  cycle: BillingCycleSchema.optional(),
  discountType: CouponDiscountTypeSchema,
  discountValue: z.number().int().positive(),
  // Resolved XOF amounts at redemption time.
  originalPriceXof: z.number().int().nonnegative(),
  discountAppliedXof: z.number().int().nonnegative(),
  finalPriceXof: z.number().int().nonnegative(),
  redeemedBy: z.string(),
  redeemedAt: z.string().datetime(),
});

export type CouponRedemption = z.infer<typeof CouponRedemptionSchema>;

// ─── Admin query ─────────────────────────────────────────────────────────

export const AdminCouponQuerySchema = z.object({
  code: z.string().max(50).optional(),
  isActive: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
    .optional(),
  planId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type AdminCouponQuery = z.infer<typeof AdminCouponQuerySchema>;

// ─── Admin redemptions query (Phase 7+ closure — coupon analytics) ───────
//
// Powers GET /v1/admin/coupons/:couponId/redemptions, the per-coupon
// drill-down used by the redemption-history tab on the admin coupon
// detail page. Paginated; defaults match the rest of the admin list
// surfaces (20 rows, page 1).
export const AdminCouponRedemptionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type AdminCouponRedemptionsQuery = z.infer<typeof AdminCouponRedemptionsQuerySchema>;

// ─── Utility — compute applied discount (pure function) ─────────────────
//
// Deterministic XOF math: percentage rounds DOWN to the nearest integer
// XOF (always advantages the customer — they never pay more than the
// ceiling of a decimal result). Fixed is capped at `originalPriceXof`
// so a 50k XOF discount on a 10k XOF plan becomes a full 10k discount
// (final = 0), not a negative number.
export function computeCouponDiscount(
  priceXof: number,
  discountType: CouponDiscountType,
  discountValue: number,
): { discountXof: number; finalPriceXof: number } {
  if (priceXof <= 0) return { discountXof: 0, finalPriceXof: 0 };
  let discountXof: number;
  if (discountType === "percentage") {
    discountXof = Math.floor((priceXof * discountValue) / 100);
  } else {
    discountXof = discountValue;
  }
  discountXof = Math.min(discountXof, priceXof);
  return { discountXof, finalPriceXof: priceXof - discountXof };
}
