import {
  type Plan,
  type PlanFeatures,
  type SubscriptionOverrides,
  type Entitlement,
  type EntitlementMap,
  PLAN_LIMIT_UNLIMITED,
  LEGACY_FEATURE_ENTITLEMENT_KEYS,
  LEGACY_QUOTA_ENTITLEMENT_KEYS,
} from "@teranga/shared-types";

// ─── Effective Plan Resolver ─────────────────────────────────────────────────
//
// Merges a base plan (from the `plans` catalog) with optional per-subscription
// overrides into the "effective" snapshot that gets denormalized onto the
// organization document for fast, synchronous enforcement reads.
//
// Key behaviors:
//  - Stored limits use -1 (PLAN_LIMIT_UNLIMITED) to represent Infinity (JSON
//    can't round-trip Infinity). The effective limits returned here use the
//    numeric JS Infinity so existing enforcement helpers — which rely on
//    `isFinite()` — keep working.
//  - `overrides.validUntil` < now → overrides expire silently and the base
//    plan is used as-is. No background job is required for correctness; a
//    subsequent denormalization refresh (triggered by subscription.* events
//    or the scheduled job in Phase 5) will rewrite the org fields.
//  - Partial overrides are supported: a missing field falls back to the base
//    plan's value.
//
// ── Unified entitlement model (Phase 7+ item #2) ─────────────────────────
// When `plan.entitlements` is present, the resolver reads the entitlement
// map as the source of truth and projects `features` + `limits` views for
// every downstream reader (the 14 legacy enforcement sites see no change).
// When absent, the resolver takes the pre-entitlement path verbatim. The
// opt-in is per-plan — the four system plans stay on the legacy path until
// a super-admin explicitly converts them.
//
// Design doc: docs/delivery-plan/entitlement-model-design.md

export interface EffectivePlan {
  planKey: string;
  planId: string;
  limits: {
    maxEvents: number;
    maxParticipantsPerEvent: number;
    maxMembers: number;
  };
  features: PlanFeatures;
  priceXof: number;
  computedAt: string;
  /**
   * The resolved entitlement map, populated when the source plan uses the
   * unified model OR when overrides.entitlements was layered on top. Opaque
   * to legacy readers — they consume the projected `features` + `limits`
   * views above, which stay authoritative and identical for entitlement
   * plans and legacy plans alike.
   */
  entitlements?: EntitlementMap;
}

export interface EffectivePlanStored {
  planKey: string;
  planId: string;
  limits: {
    maxEvents: number;
    maxParticipantsPerEvent: number;
    maxMembers: number;
  };
  features: PlanFeatures;
  computedAt: string;
  /** See EffectivePlan.entitlements. Not stringified — stored as-is. */
  entitlements?: EntitlementMap;
}

const LIMIT_KEYS = ["maxEvents", "maxParticipantsPerEvent", "maxMembers"] as const;
type LimitKey = (typeof LIMIT_KEYS)[number];

function storedToRuntime(n: number): number {
  return n === PLAN_LIMIT_UNLIMITED ? Infinity : n;
}

function runtimeToStored(n: number): number {
  return Number.isFinite(n) ? n : PLAN_LIMIT_UNLIMITED;
}

function isOverrideActive(overrides: SubscriptionOverrides | undefined, now: Date): boolean {
  if (!overrides) return false;
  if (!overrides.validUntil) return true;
  return new Date(overrides.validUntil).getTime() > now.getTime();
}

// ─── Entitlement projection ──────────────────────────────────────────────
//
// Converts an entitlement map into the legacy `PlanFeatures` + limits
// shape so the 14 existing enforcement sites keep working without a
// refactor. Missing keys fall back to a sensible default:
//  - boolean features default to `false` (deny-by-default — matches the
//    free-plan baseline, which is correctness-safe).
//  - quota limits default to `0` (deny-by-default for quotas not mentioned
//    by the plan; callers can always push the limit to -1 / unlimited
//    explicitly if they mean "no cap").
//
// The entitlement map is authoritative for the 14 keys below; any
// additional entries (e.g. `quota.sms.monthly` on a future metered plan)
// are preserved on the resolver output but don't project into legacy views.
//
// Pure function — no Firestore, no date. Unit-testable in shared-types if
// we want stricter parity checks; kept here for now to stay close to the
// resolver that consumes it.

function projectFromEntitlements(
  entitlements: EntitlementMap,
  fallbackFeatures: PlanFeatures,
  fallbackLimits: { maxEvents: number; maxParticipantsPerEvent: number; maxMembers: number },
): {
  features: PlanFeatures;
  limits: { maxEvents: number; maxParticipantsPerEvent: number; maxMembers: number };
} {
  const features = { ...fallbackFeatures };
  for (const [legacyKey, entitlementKey] of Object.entries(LEGACY_FEATURE_ENTITLEMENT_KEYS)) {
    const ent = entitlements[entitlementKey];
    if (ent && ent.kind === "boolean") {
      (features as unknown as Record<string, boolean>)[legacyKey] = ent.value;
    }
  }

  const limits = { ...fallbackLimits };
  for (const [legacyKey, entitlementKey] of Object.entries(LEGACY_QUOTA_ENTITLEMENT_KEYS)) {
    const ent = entitlements[entitlementKey];
    if (ent && ent.kind === "quota") {
      (limits as unknown as Record<string, number>)[legacyKey] = storedToRuntime(ent.limit);
    }
  }

  return { features, limits };
}

/**
 * Resolve the effective plan snapshot for an organization.
 *
 * Inputs use the stored (-1 = unlimited) representation, outputs are "runtime"
 * (Infinity = unlimited) for enforcement convenience. A separate
 * `toStoredSnapshot()` helper converts runtime → stored for Firestore writes.
 */
export function resolveEffective(
  plan: Plan,
  overrides?: SubscriptionOverrides,
  now: Date = new Date(),
): EffectivePlan {
  const active = isOverrideActive(overrides, now);

  // Base legacy-shape values (always present on every plan today).
  const baseFeatures: PlanFeatures = { ...plan.features };
  const baseLimits = {
    maxEvents: storedToRuntime(plan.limits.maxEvents),
    maxParticipantsPerEvent: storedToRuntime(plan.limits.maxParticipantsPerEvent),
    maxMembers: storedToRuntime(plan.limits.maxMembers),
  };

  // Step 1 — if the plan uses entitlements, project them onto the legacy
  // shape. The legacy `plan.features` / `plan.limits` fields act as the
  // fallback for any key the entitlement map doesn't cover, preserving
  // the back-compat invariant: every Plan doc always has a complete
  // legacy shape regardless of entitlement coverage.
  let features = baseFeatures;
  let limits = baseLimits;
  if (plan.entitlements) {
    const projected = projectFromEntitlements(plan.entitlements, baseFeatures, baseLimits);
    features = projected.features;
    limits = projected.limits;
  }

  // Step 2 — overlay legacy `overrides.limits` / `overrides.features`
  // per-field. Pre-existing behaviour, preserved verbatim.
  if (active && overrides?.limits) {
    for (const key of LIMIT_KEYS) {
      const override = overrides.limits[key as LimitKey];
      if (override !== undefined) {
        limits[key as LimitKey] = storedToRuntime(override);
      }
    }
  }
  if (active && overrides?.features) {
    for (const [k, v] of Object.entries(overrides.features)) {
      if (v !== undefined) {
        (features as unknown as Record<string, boolean>)[k] = v;
      }
    }
  }

  // Step 3 — overlay `overrides.entitlements`. Wins over legacy overrides
  // for the keys it covers (a boolean entitlement override wipes any
  // legacy feature override on the same key). This is the intended
  // precedence: entitlement overrides are the forward-looking surface.
  if (active && overrides?.entitlements) {
    const projected = projectFromEntitlements(overrides.entitlements, features, limits);
    features = projected.features;
    limits = projected.limits;
  }

  // Merge price (informational; enforcement doesn't depend on it)
  const priceXof = active && overrides?.priceXof !== undefined ? overrides.priceXof : plan.priceXof;

  // Merge entitlement map — plan's map is the base, legacy feature/limit
  // overrides are projected into entitlement space so the new helpers
  // (`requireEntitlement` / `checkQuota`) stay consistent with the
  // legacy ones (`requirePlanFeature` / `checkPlanLimit`) on the same
  // key. Without this sync, an override like `{features: {x: false}}`
  // would flip the legacy view while leaving the entitlement map with a
  // stale `{x: true}` value — the two helpers would then disagree on
  // the same org. Fix for review finding "resolver legacy override
  // doesn't sync merged entitlements".
  //
  // The override entitlement map layers last so it still wins over
  // legacy overrides for any key it explicitly covers (matches the
  // precedence already enforced on the features/limits views at
  // Step 3).
  let mergedEntitlements: EntitlementMap | undefined;
  if (plan.entitlements || (active && overrides?.entitlements) || (active && overrides?.features) || (active && overrides?.limits)) {
    mergedEntitlements = { ...(plan.entitlements ?? {}) };

    // Project legacy feature overrides into entitlement space.
    if (active && overrides?.features) {
      for (const [k, v] of Object.entries(overrides.features)) {
        if (v === undefined) continue;
        const entKey = (
          LEGACY_FEATURE_ENTITLEMENT_KEYS as Record<string, string>
        )[k];
        if (entKey) {
          mergedEntitlements[entKey] = { kind: "boolean", value: v };
        }
      }
    }

    // Project legacy limit overrides into entitlement space. We pick a
    // default `period: "cycle"` — the legacy limits have always been
    // per-billing-cycle in spirit; callers that need a different
    // period must use the entitlement map directly.
    if (active && overrides?.limits) {
      const limitKeyMap: Record<string, string> = {
        maxEvents: LEGACY_QUOTA_ENTITLEMENT_KEYS.maxEvents,
        maxParticipantsPerEvent: LEGACY_QUOTA_ENTITLEMENT_KEYS.maxParticipantsPerEvent,
        maxMembers: LEGACY_QUOTA_ENTITLEMENT_KEYS.maxMembers,
      };
      for (const [k, v] of Object.entries(overrides.limits)) {
        if (v === undefined) continue;
        const entKey = limitKeyMap[k];
        if (entKey) {
          mergedEntitlements[entKey] = { kind: "quota", limit: v, period: "cycle" };
        }
      }
    }

    // Entitlement overrides layer last — they win over legacy-override
    // projections on the same key (matches Step 3's precedence).
    if (active && overrides?.entitlements) {
      for (const [k, v] of Object.entries(overrides.entitlements)) {
        mergedEntitlements[k] = v;
      }
    }
  }

  return {
    planKey: plan.key,
    planId: plan.id,
    limits,
    features,
    priceXof,
    computedAt: now.toISOString(),
    ...(mergedEntitlements ? { entitlements: mergedEntitlements } : {}),
  };
}

/**
 * Convert a runtime `EffectivePlan` into the Firestore-storable shape used on
 * the organization document. Infinity → -1 for each limit. Quota entitlements
 * follow the same convention — their `limit` field is already stored with the
 * -1-means-unlimited invariant, so they pass through unchanged.
 */
export function toStoredSnapshot(effective: EffectivePlan): EffectivePlanStored {
  return {
    planKey: effective.planKey,
    planId: effective.planId,
    limits: {
      maxEvents: runtimeToStored(effective.limits.maxEvents),
      maxParticipantsPerEvent: runtimeToStored(effective.limits.maxParticipantsPerEvent),
      maxMembers: runtimeToStored(effective.limits.maxMembers),
    },
    features: effective.features,
    computedAt: effective.computedAt,
    ...(effective.entitlements ? { entitlements: effective.entitlements } : {}),
  };
}

/**
 * Convert a stored snapshot back to runtime form (Infinity unpacking). Used
 * by enforcement code that reads `org.effectiveLimits` after Phase 3 cutover.
 */
export function fromStoredSnapshot(stored: EffectivePlanStored): EffectivePlan {
  return {
    planKey: stored.planKey,
    planId: stored.planId,
    limits: {
      maxEvents: storedToRuntime(stored.limits.maxEvents),
      maxParticipantsPerEvent: storedToRuntime(stored.limits.maxParticipantsPerEvent),
      maxMembers: storedToRuntime(stored.limits.maxMembers),
    },
    features: stored.features,
    priceXof: 0, // price is not stored on the org doc
    computedAt: stored.computedAt,
    ...(stored.entitlements ? { entitlements: stored.entitlements } : {}),
  };
}

/**
 * Read a single entitlement by key. Returns the entitlement object if the
 * map covers that key, `undefined` otherwise. Pure lookup — no projection,
 * no legacy fallback. Callers that want legacy-fallback semantics use
 * `BaseService.requireEntitlement` / `checkQuota`.
 */
export function readEntitlement(
  entitlements: EntitlementMap | undefined,
  key: string,
): Entitlement | undefined {
  return entitlements?.[key];
}
