/**
 * Seed the QA fixture users introduced by PR #59 (admin role display fix).
 *
 * WHY A SEPARATE SCRIPT?
 *
 * `scripts/seed-emulators.ts` has a hard idempotency guard: on any non-
 * emulator target, if the `organizations` collection already has docs,
 * the seed SKIPS everything except the plan catalog + effective-limits
 * backfill. That guard protects staging/prod from accidentally wiping
 * real data — but it also means new fixture users added to the seed
 * AFTER the first deploy will never land on staging unless someone
 * runs the full seed with SEED_FORCE=true (destructive).
 *
 * This script is the escape hatch: it creates ONLY the PR #59 fixture
 * users (staff, multirole, authonly), nothing else. It's fully
 * idempotent — re-runs are no-ops when the users already exist, and a
 * re-run after a manual role change is non-destructive (we set claims
 * and set-merge the Firestore profile so the onUserCreated trigger
 * guard preserves any admin edits).
 *
 * HOW TO RUN
 *
 * Locally against the emulator (default):
 *   npx tsx scripts/seed-qa-fixtures.ts
 *
 * Against a real project (staging/prod) — requires ADC or
 * GOOGLE_APPLICATION_CREDENTIALS:
 *   SEED_TARGET=staging FIREBASE_PROJECT_ID=teranga-app-990a8 \
 *     npx tsx scripts/seed-qa-fixtures.ts
 *
 * The CD pipeline (.github/workflows/deploy-staging.yml) runs this as a
 * dedicated step right after `seed-staging` so every staging deploy
 * reasserts the three fixtures exist with the right roles.
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const SEED_TARGET = process.env.SEED_TARGET ?? "emulator";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "teranga-app-990a8";

if (SEED_TARGET === "emulator") {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
  }
}

interface Fixture {
  uid: string;
  email: string;
  password: string;
  displayName: string;
  phone?: string;
  bio?: string;
  /** Firebase Auth custom claims; empty = no custom claims set. */
  claims: { roles?: string[]; organizationId?: string };
  /**
   * Firestore profile. When null, the script deliberately does NOT write
   * a user doc — the onUserCreated trigger then provisions the default
   * `roles: ["participant"]`. This is how we validate the "fresh signup"
   * branch of the PR #59 fix.
   */
  profile: {
    roles: string[];
    organizationId?: string;
    phone?: string;
    bio?: string;
  } | null;
}

// Keep the org id aligned with scripts/seed-emulators.ts:IDS.orgId so the
// fixture users land in the same org the rest of the seed uses.
const ORG_ID = "org-001";

const FIXTURES: Fixture[] = [
  {
    uid: "staff-uid-001",
    email: "staff@teranga.dev",
    password: "password123",
    displayName: "Moussa Sy",
    phone: "+221770003333",
    bio: "Responsable contrôle d'accès — scans QR à l'entrée des événements",
    claims: { roles: ["staff"], organizationId: ORG_ID },
    profile: { roles: ["staff"], organizationId: ORG_ID },
  },
  {
    uid: "multirole-uid-001",
    email: "multirole@teranga.dev",
    password: "password123",
    displayName: "Khadija Diop",
    phone: "+221770004444",
    bio: "Organise et intervient sur les meetups Flutter Dakar",
    claims: { roles: ["organizer", "speaker"], organizationId: ORG_ID },
    profile: { roles: ["organizer", "speaker"], organizationId: ORG_ID },
  },
  {
    uid: "authonly-uid-001",
    email: "authonly@teranga.dev",
    password: "password123",
    displayName: "Thierno Wade",
    // No custom claims and no Firestore profile — the onUserCreated
    // trigger must land this user with the default `roles: ["participant"]`.
    // This is the ONE fixture that should render as Participant in the
    // admin table (the PR #59 "fresh signup" branch).
    claims: {},
    profile: null,
  },
];

async function upsertFixture(fx: Fixture): Promise<"created" | "existed"> {
  const auth = getAuth();
  const db = getFirestore();

  // 1. Create (or fetch) the Firebase Auth user.
  let created = false;
  try {
    await auth.createUser({
      uid: fx.uid,
      email: fx.email,
      password: fx.password,
      displayName: fx.displayName,
      emailVerified: true,
    });
    created = true;
  } catch (err: unknown) {
    const code = (err as { errorInfo?: { code?: string } })?.errorInfo?.code;
    if (code !== "auth/uid-already-exists") throw err;
    // User already exists — refresh displayName so a seed change propagates.
    await auth.updateUser(fx.uid, { displayName: fx.displayName });
  }

  // 2. Apply custom claims (or explicitly clear to `{}` when none).
  if (fx.claims.roles || fx.claims.organizationId) {
    await auth.setCustomUserClaims(fx.uid, fx.claims);
  }

  // 3. Write the Firestore profile (upsert) — skipped for authonly by design.
  if (fx.profile) {
    const now = new Date().toISOString();
    await db
      .collection("users")
      .doc(fx.uid)
      .set(
        {
          uid: fx.uid,
          email: fx.email,
          displayName: fx.displayName,
          photoURL: null,
          phone: fx.profile.phone ?? null,
          bio: fx.profile.bio ?? null,
          roles: fx.profile.roles,
          organizationId: fx.profile.organizationId ?? null,
          preferredLanguage: "fr",
          fcmTokens: [],
          isEmailVerified: true,
          isActive: true,
          updatedAt: now,
          // `createdAt` preserved on re-runs via { merge: true }.
          createdAt: now,
        },
        { merge: true },
      );
  }

  return created ? "created" : "existed";
}

async function main() {
  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }

  console.log(`\n👤 Seeding QA fixture users (target=${SEED_TARGET}, project=${PROJECT_ID})...`);

  let created = 0;
  let existed = 0;
  for (const fx of FIXTURES) {
    const outcome = await upsertFixture(fx);
    if (outcome === "created") created++;
    else existed++;
    const badge = outcome === "created" ? "✓ created" : "· existed";
    console.log(`  ${badge}  ${fx.email.padEnd(28)}  → ${fx.displayName}`);
  }

  console.log(`\n✓ Done. ${created} created, ${existed} already existed.`);
  console.log("  Verify at /admin/users — each row should show its real role badge (see PR #59).");
}

// Only run when executed directly (not when imported by another script).
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  main().catch((err) => {
    console.error("QA fixture seed failed:", err);
    process.exit(1);
  });
}
