import { z } from "zod";

// ─── Feature Flag Schema (Phase 6 admin overhaul) ────────────────────────────
//
// Platform-wide feature flags live in the `featureFlags` Firestore collection.
// Doc id = flag key. Super-admin only (write via POST/PUT /v1/admin/feature-
// flags, read denied to client SDK — all reads go through the API).
//
// `rolloutPercent` is a 0..100 knob ready for future hash-and-gate clients
// (`useFeatureFlag(key)`). The evaluator hasn't shipped yet — for now a flag
// is either on (enabled=true) or off. Values outside 0..100 are rejected.
//
// The schema lives in shared-types so the route validator, the UI form, and
// the future runtime evaluator all agree on the same shape.

export const FeatureFlagKeySchema = z
  .string()
  .min(1)
  .max(64)
  // Lowercase + digits + dash/underscore/dot. Keeps keys grep-able across
  // the codebase and avoids case-sensitivity headaches in URLs.
  .regex(/^[a-z0-9-_.]+$/, "Lettres minuscules, chiffres, tirets, points, underscores seulement");

export const FeatureFlagSchema = z.object({
  key: FeatureFlagKeySchema,
  enabled: z.boolean(),
  description: z.string().max(200).nullable(),
  /** 0..100 — rollout percentage. 100 = fully on for everyone. */
  rolloutPercent: z.number().int().min(0).max(100),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().min(1),
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

/** Body accepted by PUT /v1/admin/feature-flags/:key. */
export const UpsertFeatureFlagSchema = z.object({
  enabled: z.boolean(),
  description: z.string().max(200).nullish(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
});
export type UpsertFeatureFlagDto = z.infer<typeof UpsertFeatureFlagSchema>;
