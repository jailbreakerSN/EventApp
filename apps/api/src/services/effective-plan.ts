import {
  type Plan,
  type PlanFeatures,
  type SubscriptionOverrides,
  PLAN_LIMIT_UNLIMITED,
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

  // Merge limits
  const limits = {
    maxEvents: storedToRuntime(plan.limits.maxEvents),
    maxParticipantsPerEvent: storedToRuntime(plan.limits.maxParticipantsPerEvent),
    maxMembers: storedToRuntime(plan.limits.maxMembers),
  };

  if (active && overrides?.limits) {
    for (const key of LIMIT_KEYS) {
      const override = overrides.limits[key as LimitKey];
      if (override !== undefined) {
        limits[key as LimitKey] = storedToRuntime(override);
      }
    }
  }

  // Merge features
  const features: PlanFeatures = { ...plan.features };
  if (active && overrides?.features) {
    for (const [k, v] of Object.entries(overrides.features)) {
      if (v !== undefined) {
        (features as unknown as Record<string, boolean>)[k] = v;
      }
    }
  }

  // Merge price (informational; enforcement doesn't depend on it)
  const priceXof = active && overrides?.priceXof !== undefined ? overrides.priceXof : plan.priceXof;

  return {
    planKey: plan.key,
    planId: plan.id,
    limits,
    features,
    priceXof,
    computedAt: now.toISOString(),
  };
}

/**
 * Convert a runtime `EffectivePlan` into the Firestore-storable shape used on
 * the organization document. Infinity → -1 for each limit.
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
  };
}
