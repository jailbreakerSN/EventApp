import { z } from "zod";
import { OrganizationPlanSchema } from "./organization.types";
import { PaymentMethodSchema } from "./payment.types";

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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Subscription = z.infer<typeof SubscriptionSchema>;

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
});

export type UpgradePlanDto = z.infer<typeof UpgradePlanSchema>;

export const DowngradePlanSchema = z.object({
  plan: OrganizationPlanSchema.refine((p) => p !== "enterprise", {
    message: "Impossible de passer au plan enterprise via downgrade",
  }),
});

export type DowngradePlanDto = z.infer<typeof DowngradePlanSchema>;
