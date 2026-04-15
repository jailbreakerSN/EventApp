/**
 * Seed the `plans` catalog with the four system plans.
 *
 * This is idempotent: it upserts by `key`. Re-running the script updates the
 * price/limits/features of existing system plans to match the source values in
 * `PLAN_LIMITS` / `PLAN_DISPLAY` (shared-types) — so a code change that tunes
 * a tier's limits can be synced with `npx tsx scripts/seed-plans.ts`.
 *
 * Runs against Firebase emulators by default. Set `SEED_TARGET=staging` (or
 * any non-emulator value) to write to a real Firestore — uses Application
 * Default Credentials.
 *
 * Usage:
 *   npx tsx scripts/seed-plans.ts
 *   SEED_TARGET=staging FIREBASE_PROJECT_ID=teranga-events-staging npx tsx scripts/seed-plans.ts
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  PLAN_LIMITS,
  PLAN_DISPLAY,
  PLAN_LIMIT_UNLIMITED,
  type OrganizationPlan,
  type Plan,
  type PlanFeatures,
  type PricingModel,
} from "@teranga/shared-types";

const SEED_TARGET = process.env.SEED_TARGET ?? "emulator";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "teranga-app-990a8";

if (SEED_TARGET === "emulator" && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
}

// Serialize Infinity → PLAN_LIMIT_UNLIMITED (-1) for Firestore.
function toStoredLimit(n: number): number {
  return Number.isFinite(n) ? n : PLAN_LIMIT_UNLIMITED;
}

const SYSTEM_PLAN_ORDER: readonly OrganizationPlan[] = [
  "free",
  "starter",
  "pro",
  "enterprise",
] as const;

const DESCRIPTIONS: Record<OrganizationPlan, { fr: string; en: string }> = {
  free: {
    fr: "Idéal pour découvrir Teranga : jusqu'à 3 événements, 50 participants par événement.",
    en: "Perfect for trying Teranga out: up to 3 events, 50 participants each.",
  },
  starter: {
    fr: "Pour les petits organisateurs : QR scanning, 10 événements, 200 participants.",
    en: "For small organizers: QR scanning, 10 events, 200 participants.",
  },
  pro: {
    fr: "La suite complète pour les agences événementielles : analytics, SMS, portails.",
    en: "The full suite for event agencies: analytics, SMS, portals.",
  },
  enterprise: {
    fr: "Sans limites, avec API, marque blanche et accompagnement dédié. Tarif sur devis.",
    en: "Unlimited, API access, white-label, dedicated support. Custom pricing.",
  },
};

// Pricing model per system plan. Disambiguates priceXof=0 between "truly
// free" (Free tier) and "contact sales" (Enterprise).
const PRICING_MODEL: Record<OrganizationPlan, PricingModel> = {
  free: "free",
  starter: "fixed",
  pro: "fixed",
  enterprise: "custom",
};

// Default trial length (in days) per system plan. Phase 7+ item #4 — shipping
// trials is the cheapest free→paid conversion lever available. A first-time
// upgrade from free picks up this value; later upgrades from a paid tier skip
// the trial entirely.
//
//   - `free` / `enterprise` → null (neither is a self-service trial target)
//   - `starter` → 0 (cheapest tier — we want immediate activation)
//   - `pro` → 14 (the growth-driver tier; 14 days is the conversion sweet spot
//     per Stripe/Chargebee benchmarks for B2B SaaS)
//
// Operators can tune per-tier trial length via the admin UI — the change
// mints a new plan version (grandfathering-safe) so existing trialing
// customers keep their original promise.
const TRIAL_DAYS: Record<OrganizationPlan, number | null> = {
  free: null,
  starter: 0,
  pro: 14,
  enterprise: null,
};

function buildSystemPlanDoc(
  key: OrganizationPlan,
  sortOrder: number,
  now: string,
): Omit<Plan, "id"> & { id: string } {
  const limits = PLAN_LIMITS[key];
  const display = PLAN_DISPLAY[key];

  const features: PlanFeatures = limits.features;

  // Deterministic document ID = plan key. System plans have a stable id so
  // cross-references (Subscription.planId) don't change between seeds.
  //
  // Versioning (Phase 7): each system plan is seeded as `version: 1` with a
  // deterministic `lineageId` (= `"lin-<key>-system"`) so re-running the seed
  // is always an in-place merge on v1 — it never accidentally mints a new
  // version. Actual version bumps come from `planService.update()` in
  // response to a superadmin edit.
  return {
    id: key,
    key,
    name: display.name,
    description: DESCRIPTIONS[key],
    pricingModel: PRICING_MODEL[key],
    priceXof: display.priceXof,
    currency: "XOF",
    limits: {
      maxEvents: toStoredLimit(limits.maxEvents),
      maxParticipantsPerEvent: toStoredLimit(limits.maxParticipantsPerEvent),
      maxMembers: toStoredLimit(limits.maxMembers),
    },
    features,
    isSystem: true,
    isPublic: true,
    isArchived: false,
    sortOrder,
    trialDays: TRIAL_DAYS[key],
    version: 1,
    lineageId: `lin-${key}-system`,
    isLatest: true,
    previousVersionId: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedPlans(db: Firestore): Promise<number> {
  const now = new Date().toISOString();
  let count = 0;

  for (let i = 0; i < SYSTEM_PLAN_ORDER.length; i++) {
    const key = SYSTEM_PLAN_ORDER[i];
    const doc = buildSystemPlanDoc(key, i, now);
    const ref = db.collection("plans").doc(doc.id);
    const snap = await ref.get();

    if (snap.exists) {
      // Preserve createdAt + existing versioning metadata. The seed must
      // NEVER auto-bump version — that's the superadmin's call via
      // `planService.update()`. If a staging/prod deploy tunes the source
      // `PLAN_LIMITS` numbers, the seed merges them into v1 and the real
      // cutover should go through the service (grandfathered on prod).
      const current = snap.data() ?? {};
      await ref.set(
        {
          ...doc,
          createdAt: (current.createdAt as string) ?? now,
          // Preserve lineage identity across re-seeds if the doc was written
          // by an older seeder that didn't stamp these fields.
          version: (current.version as number | undefined) ?? 1,
          lineageId: (current.lineageId as string | undefined) ?? doc.lineageId,
          isLatest: (current.isLatest as boolean | undefined) ?? true,
          previousVersionId: (current.previousVersionId as string | null | undefined) ?? null,
        },
        { merge: true },
      );
    } else {
      await ref.set(doc);
    }
    count++;
  }

  return count;
}

// ─── Standalone runner ───────────────────────────────────────────────────────

async function main() {
  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }
  const db = getFirestore();

  console.log(`\n💼 Seeding plan catalog (target: ${SEED_TARGET})...`);
  const n = await seedPlans(db);
  console.log(`  ✓ Upserted ${n} system plans (free, starter, pro, enterprise)`);
}

// Only run if executed directly (not when imported by seed-emulators.ts)
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  main().catch((err) => {
    console.error("Seed plans failed:", err);
    process.exit(1);
  });
}
