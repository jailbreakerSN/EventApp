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

export const PlanSchema = z.object({
  id: z.string(),
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, "La clé doit être en minuscules, alphanumérique"),
  name: LocalizedStringSchema,
  description: LocalizedDescriptionSchema.nullable().optional(),
  priceXof: z.number().int().min(0),
  currency: z.literal("XOF").default("XOF"),
  limits: PlanLimitsValueSchema,
  features: PlanFeaturesSchema,
  isSystem: z.boolean().default(false),
  isPublic: z.boolean().default(true),
  isArchived: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Plan = z.infer<typeof PlanSchema>;

// ─── Create / Update DTOs ────────────────────────────────────────────────────

export const CreatePlanSchema = z.object({
  key: PlanSchema.shape.key,
  name: LocalizedStringSchema,
  description: LocalizedDescriptionSchema.nullable().optional(),
  priceXof: z.number().int().min(0),
  limits: PlanLimitsValueSchema,
  features: PlanFeaturesSchema,
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export type CreatePlanDto = z.infer<typeof CreatePlanSchema>;

// System plans protect `key` and `isSystem`; everything else is editable.
export const UpdatePlanSchema = z
  .object({
    name: LocalizedStringSchema,
    description: LocalizedDescriptionSchema.nullable(),
    priceXof: z.number().int().min(0),
    limits: PlanLimitsValueSchema,
    features: PlanFeaturesSchema,
    isPublic: z.boolean(),
    isArchived: z.boolean(),
    sortOrder: z.number().int(),
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
