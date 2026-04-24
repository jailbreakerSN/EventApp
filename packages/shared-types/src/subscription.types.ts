import { z } from "zod";
import { OrganizationPlanSchema } from "./organization.types";
import { PaymentMethodSchema } from "./payment.types";
import { ScheduledChangeSchema, SubscriptionOverridesSchema } from "./plan.types";

// ─── Billing Cycle (Phase 7+ item #3) ───────────────────────────────────────
// A subscription renews on either a monthly or an annual cadence. Annual subs
// typically get a 15-20% discount in exchange for upfront commitment — industry-
// standard SaaS pattern.
export const BillingCycleSchema = z.enum(["monthly", "annual"]);
export type BillingCycle = z.infer<typeof BillingCycleSchema>;

// ─── Subscription Status ────────────────────────────────────────────────────

export const SubscriptionStatusSchema = z.enum([
  "active", // currently active subscription
  "past_due", // payment failed, in grace period
  "cancelled", // subscription cancelled
  "trialing", // trial period (first event free on Pro, etc.)
]);

export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

// ─── Subscription Document ──────────────────────────────────────────────────

export const SubscriptionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  plan: OrganizationPlanSchema,
  status: SubscriptionStatusSchema,
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  cancelledAt: z.string().datetime().nullable(),
  cancelReason: z.string().nullable().optional(),
  paymentMethod: PaymentMethodSchema.nullable(),
  priceXof: z.number().int(),
  // ── Billing cycle (Phase 7+ item #3) ──────────────────────────────────────
  // Which cadence the customer pays on. `priceXof` above is whatever they are
  // actually charged per period — if `billingCycle === "annual"`, priceXof
  // equals the plan's annualPriceXof; if monthly, the plan's priceXof. The
  // rollover worker reads this field when advancing currentPeriodEnd at the
  // end of a trial or a scheduled plan change.
  billingCycle: BillingCycleSchema.optional(),
  // ── Dynamic plan fields (Phase 2+) ────────────────────────────────────────
  // Optional during migration: when present, `planId` is the authoritative
  // reference to the plans/{id} catalog doc and `overrides` layers per-org
  // customization on top. The legacy `plan` enum stays in sync for backward
  // compatibility but Phase 3 treats `planId` as the source of truth.
  planId: z.string().optional(),
  overrides: SubscriptionOverridesSchema.optional(),
  assignedBy: z.string().optional(),
  assignedAt: z.string().datetime().optional(),
  // ── Prepaid period honoring (Phase 4c) ────────────────────────────────────
  // A plan change queued for `effectiveAt` (usually currentPeriodEnd). While
  // this field is set, the subscription's `plan` / `effectiveLimits` on the
  // org doc remain unchanged — the user keeps their paid tier until the
  // daily rollover job applies the scheduled flip. Upgrading, immediate
  // downgrading, and the revert endpoint all clear it by writing `null`.
  scheduledChange: ScheduledChangeSchema.nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Subscription = z.infer<typeof SubscriptionSchema>;

// ─── Admin Subscription Query ──────────────────────────────────────────────
/**
 * Admin subscription listing. Behind `platform:manage`, reads across
 * every organisation. Powers `/admin/subscriptions?status=past_due`
 * (inbox deep-link) so operators can see the impacted orgs / amounts
 * without hunting through `/admin/organizations`.
 */
export const AdminSubscriptionQuerySchema = z.object({
  status: SubscriptionStatusSchema.optional(),
  plan: OrganizationPlanSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  orderBy: z.enum(["updatedAt", "currentPeriodEnd", "priceXof"]).default("updatedAt"),
  orderDir: z.enum(["asc", "desc"]).default("desc"),
});

export type AdminSubscriptionQuery = z.infer<typeof AdminSubscriptionQuerySchema>;

// ─── Plan Usage ─────────────────────────────────────────────────────────────
// Computed on-demand, not stored. Returned by the usage endpoint.

export const PlanUsageSchema = z.object({
  plan: OrganizationPlanSchema,
  events: z.object({
    current: z.number().int(),
    limit: z.number(), // Infinity for unlimited
  }),
  members: z.object({
    current: z.number().int(),
    limit: z.number(),
  }),
  features: z.record(z.string(), z.boolean()),
});

export type PlanUsage = z.infer<typeof PlanUsageSchema>;

// ─── Upgrade / Downgrade DTOs ───────────────────────────────────────────────

export const UpgradePlanSchema = z.object({
  plan: OrganizationPlanSchema.refine((p) => p !== "free", {
    message: "Impossible de passer au plan gratuit via upgrade",
  }),
  // Phase 7+ item #3: which billing cycle to commit to. Defaults to monthly
  // to preserve pre-#3 behaviour. Annual requires the target plan to carry
  // an `annualPriceXof` — the service rejects annual upgrades on plans that
  // only offer monthly.
  cycle: BillingCycleSchema.optional(),
});

export type UpgradePlanDto = z.infer<typeof UpgradePlanSchema>;

export const DowngradePlanSchema = z.object({
  plan: OrganizationPlanSchema.refine((p) => p !== "enterprise", {
    message: "Impossible de passer au plan enterprise via downgrade",
  }),
  // Phase 4c: by default a downgrade is SCHEDULED for the end of the current
  // paid period (prepaid rights honored). Set `immediate: true` to flip now
  // — requires the `subscription:override` permission (admin emergency).
  immediate: z.boolean().optional().default(false),
});

export type DowngradePlanDto = z.infer<typeof DowngradePlanSchema>;

// Cancel body — same shape as downgrade minus the target (always "free").
export const CancelSubscriptionSchema = z.object({
  immediate: z.boolean().optional().default(false),
  reason: z.string().max(500).optional(),
});

export type CancelSubscriptionDto = z.infer<typeof CancelSubscriptionSchema>;
