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
    fr: "Sans limites, avec API, marque blanche et accompagnement dédié.",
    en: "Unlimited, API access, white-label, dedicated support.",
  },
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
  return {
    id: key,
    key,
    name: display.name,
    description: DESCRIPTIONS[key],
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
      // Preserve createdAt; update everything else to match shared-types source.
      await ref.set(
        {
          ...doc,
          createdAt: (snap.data()?.createdAt as string) ?? now,
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
