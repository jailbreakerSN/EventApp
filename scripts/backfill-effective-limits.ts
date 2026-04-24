/**
 * Backfill effectiveLimits / effectiveFeatures / effectivePlanKey /
 * effectiveComputedAt onto every existing organization document.
 *
 * Phase 2 of the dynamic plan migration: after the `plans` catalog has been
 * seeded (see `seed-plans.ts`), run this script to denormalize the resolved
 * plan snapshot onto each org. Once every org carries these fields, Phase 3
 * will switch enforcement to read them directly.
 *
 * Behavior:
 *  - Fetches every document in `organizations/`.
 *  - Resolves the catalog plan by the org's current `plan` enum key.
 *  - Merges any subscription overrides present on the org's subscription.
 *  - Writes effectiveLimits (as stored form: -1 = unlimited), effectiveFeatures,
 *    effectivePlanKey, effectiveComputedAt.
 *  - Idempotent: re-running overwrites the four fields with freshly resolved
 *    values. Safe to run after every catalog edit until the scheduled Phase 5
 *    fan-out job is in place.
 *
 * Usage:
 *   # Against emulators (default)
 *   npx tsx scripts/backfill-effective-limits.ts
 *
 *   # Against a real project — requires ADC / GOOGLE_APPLICATION_CREDENTIALS
 *   SEED_TARGET=staging FIREBASE_PROJECT_ID=teranga-app-990a8 \
 *     npx tsx scripts/backfill-effective-limits.ts
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  type Organization,
  type Plan,
  type Subscription,
  type EntitlementMap,
  PLAN_LIMIT_UNLIMITED,
  LEGACY_FEATURE_ENTITLEMENT_KEYS,
  LEGACY_QUOTA_ENTITLEMENT_KEYS,
} from "@teranga/shared-types";

const SEED_TARGET = process.env.SEED_TARGET ?? "emulator";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "teranga-app-990a8";

if (SEED_TARGET === "emulator" && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
}

type StoredLimits = {
  maxEvents: number;
  maxParticipantsPerEvent: number;
  maxMembers: number;
};

function runtimeToStored(n: number): number {
  return Number.isFinite(n) ? n : PLAN_LIMIT_UNLIMITED;
}

function storedToRuntime(n: number): number {
  return n === PLAN_LIMIT_UNLIMITED ? Infinity : n;
}

function isOverrideActive(overrides: Subscription["overrides"] | undefined, now: Date): boolean {
  if (!overrides) return false;
  if (!overrides.validUntil) return true;
  return new Date(overrides.validUntil).getTime() > now.getTime();
}

interface Resolved {
  planKey: string;
  planId: string;
  limits: StoredLimits;
  features: Plan["features"];
  computedAt: string;
  // Phase 7+ item #2 — denormalized entitlement map written alongside the
  // legacy fields. Always populated (possibly as {}) so moving between
  // unified plans and legacy plans doesn't leave stale keys.
  entitlements: EntitlementMap;
}

function resolveFromPlan(
  plan: Plan,
  overrides: Subscription["overrides"] | undefined,
  now: Date,
): Resolved {
  const active = isOverrideActive(overrides, now);

  // Phase 7+ item #2 — merge order MUST match the production resolver
  // in apps/api/src/services/effective-plan.ts. Order:
  //   Step 1. Start from plan.features + plan.limits.
  //   Step 2. If plan.entitlements is set, project it over the base.
  //   Step 3. Apply legacy overrides (overrides.features/limits).
  //   Step 4. Apply entitlement overrides — they win over legacy overrides
  //           on the same key, by virtue of being applied last.
  //
  // Review blocker B3 closed: the previous order here was
  //   base → legacy-overrides → plan.entitlements → override.entitlements
  // which made plan entitlements clobber legacy overrides (exact opposite
  // of the production resolver). Back-sync the merge so a backfill run
  // never produces a denorm state that a live enforcement refresh
  // would change.

  // Step 1 — plan base
  const baseLimits = plan.limits;
  const limitsRuntime = {
    maxEvents: storedToRuntime(baseLimits.maxEvents),
    maxParticipantsPerEvent: storedToRuntime(baseLimits.maxParticipantsPerEvent),
    maxMembers: storedToRuntime(baseLimits.maxMembers),
  };
  const features: Plan["features"] = { ...plan.features };

  // Step 2 — plan entitlements project onto the legacy shape.
  if (plan.entitlements) {
    for (const [legacy, entKey] of Object.entries(LEGACY_FEATURE_ENTITLEMENT_KEYS)) {
      const ent = plan.entitlements[entKey];
      if (ent && ent.kind === "boolean") {
        (features as Record<string, boolean>)[legacy] = ent.value;
      }
    }
    for (const [legacy, entKey] of Object.entries(LEGACY_QUOTA_ENTITLEMENT_KEYS)) {
      const ent = plan.entitlements[entKey];
      if (ent && ent.kind === "quota") {
        (limitsRuntime as Record<string, number>)[legacy] = storedToRuntime(ent.limit);
      }
    }
  }

  // Step 3 — legacy overrides.
  if (active && overrides?.limits) {
    if (overrides.limits.maxEvents !== undefined) {
      limitsRuntime.maxEvents = storedToRuntime(overrides.limits.maxEvents);
    }
    if (overrides.limits.maxParticipantsPerEvent !== undefined) {
      limitsRuntime.maxParticipantsPerEvent = storedToRuntime(
        overrides.limits.maxParticipantsPerEvent,
      );
    }
    if (overrides.limits.maxMembers !== undefined) {
      limitsRuntime.maxMembers = storedToRuntime(overrides.limits.maxMembers);
    }
  }
  if (active && overrides?.features) {
    for (const [k, v] of Object.entries(overrides.features)) {
      if (v !== undefined) {
        (features as Record<string, boolean>)[k] = v;
      }
    }
  }

  // Step 4 — entitlement overrides (layered last, so they win over legacy
  // overrides on the same key). Mirrors production resolver step 3.
  const activeOverrideEnt =
    active && overrides?.entitlements ? overrides.entitlements : undefined;
  if (activeOverrideEnt) {
    for (const [legacy, entKey] of Object.entries(LEGACY_FEATURE_ENTITLEMENT_KEYS)) {
      const ent = activeOverrideEnt[entKey];
      if (ent && ent.kind === "boolean") {
        (features as Record<string, boolean>)[legacy] = ent.value;
      }
    }
    for (const [legacy, entKey] of Object.entries(LEGACY_QUOTA_ENTITLEMENT_KEYS)) {
      const ent = activeOverrideEnt[entKey];
      if (ent && ent.kind === "quota") {
        (limitsRuntime as Record<string, number>)[legacy] = storedToRuntime(ent.limit);
      }
    }
  }

  const mergedEntitlements: EntitlementMap = {
    ...(plan.entitlements ?? {}),
    ...(activeOverrideEnt ?? {}),
  };

  return {
    planKey: plan.key,
    planId: plan.id,
    limits: {
      maxEvents: runtimeToStored(limitsRuntime.maxEvents),
      maxParticipantsPerEvent: runtimeToStored(limitsRuntime.maxParticipantsPerEvent),
      maxMembers: runtimeToStored(limitsRuntime.maxMembers),
    },
    features,
    computedAt: now.toISOString(),
    entitlements: mergedEntitlements,
  };
}

export async function backfillEffectiveLimits(db: Firestore): Promise<{
  total: number;
  updated: number;
  skipped: number;
  missingPlan: string[];
}> {
  const now = new Date();

  // Load the catalog once, index by key for quick lookup.
  const plansSnap = await db.collection("plans").get();
  const plans = new Map<string, Plan>();
  for (const doc of plansSnap.docs) {
    const data = doc.data() as Omit<Plan, "id"> & { id?: string };
    plans.set(data.key, { ...(data as Plan), id: doc.id });
  }

  if (plans.size === 0) {
    throw new Error("Le catalogue de plans est vide. Lance d'abord scripts/seed-plans.ts.");
  }

  // Preload subscriptions indexed by organizationId so we can pick up overrides.
  const subsSnap = await db.collection("subscriptions").get();
  const subsByOrg = new Map<string, Subscription>();
  for (const doc of subsSnap.docs) {
    const sub = { id: doc.id, ...(doc.data() as Omit<Subscription, "id">) } as Subscription;
    subsByOrg.set(sub.organizationId, sub);
  }

  const orgsSnap = await db.collection("organizations").get();
  let updated = 0;
  let skipped = 0;
  const missingPlan: string[] = [];

  for (const orgDoc of orgsSnap.docs) {
    const org = { id: orgDoc.id, ...(orgDoc.data() as Omit<Organization, "id">) } as Organization;
    const plan = plans.get(org.plan);

    if (!plan) {
      missingPlan.push(`${org.id} (plan=${org.plan})`);
      skipped++;
      continue;
    }

    const sub = subsByOrg.get(org.id);
    const resolved = resolveFromPlan(plan, sub?.overrides, now);

    await orgDoc.ref.update({
      effectiveLimits: resolved.limits,
      effectiveFeatures: resolved.features,
      effectivePlanKey: resolved.planKey,
      effectiveComputedAt: resolved.computedAt,
      // Phase 7+ item #2 — always write the entitlement map (empty when
      // the plan has none) so a later reassignment from unified → legacy
      // can't leave stale keys behind.
      effectiveEntitlements: resolved.entitlements,
      updatedAt: now.toISOString(),
    });
    updated++;
  }

  return {
    total: orgsSnap.size,
    updated,
    skipped,
    missingPlan,
  };
}

async function main() {
  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }
  const db = getFirestore();

  console.log(`\n🔁 Backfilling effective limits (target: ${SEED_TARGET})...`);
  const result = await backfillEffectiveLimits(db);
  console.log(`  ✓ Organisations processed: ${result.total}`);
  console.log(`  ✓ Updated: ${result.updated}`);
  if (result.skipped > 0) {
    console.log(`  ⚠ Skipped: ${result.skipped}`);
    for (const entry of result.missingPlan) {
      console.log(`    - ${entry}`);
    }
  }
}

const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  main().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
}
