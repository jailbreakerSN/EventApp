/**
 * Reset the seed environment to an empty state (plans catalog preserved).
 *
 * Wipes three surfaces in lock-step:
 *   - **Firestore** — every collection in `RESETTABLE_COLLECTIONS`
 *   - **Auth**      — every user with an `@teranga.dev` email (the seed
 *                    domain; documented as dev-only)
 *   - **Storage**   — every object under the configured bucket whose path
 *                    starts with `seed/`, `badges/`, `events/`,
 *                    `organizations/`, or `users/` (the only paths the
 *                    seed + the API's signed-URL surfaces ever write to)
 *
 * Designed for the staging refresh flow: run `seed-reset` → `seed-emulators`
 * in that order to wipe everything and re-seed from the current fixture set.
 *
 * Safety rails (all MUST pass before any write — Sprint E hardens this to
 * a true 3-gate flow):
 *   1. **GATE 1 — allow-list.** `FIREBASE_PROJECT_ID` is in
 *      `SEED_ALLOW_LIST` (see scripts/seed/config.ts — production is NOT
 *      in the list).
 *   2. **GATE 2 — explicit confirm.** `SEED_RESET_CONFIRM=YES_RESET`.
 *   3. **GATE 3 — typed phrase + project echo.** For non-emulator targets,
 *      additionally require both `CONFIRM_PROJECT=<FIREBASE_PROJECT_ID>`
 *      AND `CONFIRM_PHRASE=RESET STAGING DATABASE NOW`. Forces the caller
 *      to commit a typo-resistant intent statement.
 *
 * Modes:
 *   - Default: writes are real.
 *   - `--dry-run` (or `RESET_DRY_RUN=true`): scans the surfaces and reports
 *     volumes without deleting anything. Useful in PR review of this
 *     script + before the first staging run after a major schema change.
 *
 * Usage (local emulators):
 *   SEED_RESET_CONFIRM=YES_RESET npx tsx scripts/seed-reset.ts
 *   SEED_RESET_CONFIRM=YES_RESET npx tsx scripts/seed-reset.ts --dry-run
 *
 * Usage (staging — gated behind the seed-staging GitHub Actions workflow):
 *   SEED_TARGET=staging \
 *   FIREBASE_PROJECT_ID=teranga-app-990a8 \
 *   SEED_RESET_CONFIRM=YES_RESET \
 *   CONFIRM_PROJECT=teranga-app-990a8 \
 *   CONFIRM_PHRASE="RESET STAGING DATABASE NOW" \
 *     npx tsx scripts/seed-reset.ts
 *
 * Operator runbook: docs-v2/50-operations/staging-reset.md.
 */

import {
  PROJECT_ID,
  PROJECT_LABEL,
  RESETTABLE_COLLECTIONS,
  SEED_TARGET,
  assertSafeTarget,
  configureEmulatorHosts,
} from "./seed/config";

configureEmulatorHosts();
assertSafeTarget({ allowReset: true });

// ─── Mode flags ────────────────────────────────────────────────────────────

const DRY_RUN =
  process.argv.includes("--dry-run") || process.env.RESET_DRY_RUN === "true";

const STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET ?? `${PROJECT_ID}.appspot.com`;

// Storage paths the seed + API ever write to. Anything outside these
// prefixes is left alone — operators may keep their own dev fixtures
// (mock images, test PDFs) under other paths without losing them on
// every reset.
const STORAGE_PATH_PREFIXES = [
  "seed/",
  "badges/",
  "events/",
  "organizations/",
  "users/",
] as const;

// ─── Gate 3 (typed-phrase) for non-emulator targets ────────────────────────

if (SEED_TARGET !== "emulator") {
  const typedProject = process.env.CONFIRM_PROJECT;
  if (typedProject !== PROJECT_ID) {
    throw new Error(
      `CONFIRM_PROJECT mismatch. Set CONFIRM_PROJECT=${PROJECT_ID} to reset project ${PROJECT_ID}.`,
    );
  }
  const typedPhrase = process.env.CONFIRM_PHRASE;
  const expectedPhrase = "RESET STAGING DATABASE NOW";
  if (typedPhrase !== expectedPhrase) {
    throw new Error(
      `CONFIRM_PHRASE mismatch. Set CONFIRM_PHRASE="${expectedPhrase}" to reset project ${PROJECT_ID}.`,
    );
  }
}

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const app = initializeApp({ projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// ─── Firestore ────────────────────────────────────────────────────────────

/**
 * Delete all documents in a single collection, 500 at a time (Firestore's
 * batch write limit). In `--dry-run`, returns the count that WOULD be
 * deleted without writing.
 */
async function processCollection(
  fs: Firestore,
  collection: string,
  batchSize = 500,
): Promise<number> {
  if (DRY_RUN) {
    // Dry-run: just count. Cap at 1 200 per collection to bound the
    // emulator round-trip cost — anything bigger gets reported as
    // "1 200+".
    const probe = await fs.collection(collection).limit(1200).get();
    return probe.size;
  }

  let totalDeleted = 0;
  for (;;) {
    const snap = await fs.collection(collection).limit(batchSize).get();
    if (snap.empty) return totalDeleted;

    const batch = fs.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    totalDeleted += snap.size;

    if (snap.size < batchSize) return totalDeleted;
  }
}

// ─── Auth ──────────────────────────────────────────────────────────────────

/**
 * Delete every seed-created Auth user. Identified by the `@teranga.dev`
 * email suffix — the seed is the only source of users with that domain, so
 * a real participant who happens to sign up with `foo@teranga.dev` would be
 * deleted by this reset. The seed domain is already documented as dev-only.
 */
async function processAuthUsers(): Promise<number> {
  if (DRY_RUN) {
    let count = 0;
    let nextPageToken: string | undefined;
    do {
      const page = await auth.listUsers(1000, nextPageToken);
      count += page.users.filter((u) =>
        (u.email ?? "").endsWith("@teranga.dev"),
      ).length;
      nextPageToken = page.pageToken;
    } while (nextPageToken);
    return count;
  }

  let deleted = 0;
  let nextPageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    const seedUids = page.users
      .filter((u) => (u.email ?? "").endsWith("@teranga.dev"))
      .map((u) => u.uid);
    if (seedUids.length > 0) {
      const res = await auth.deleteUsers(seedUids);
      deleted += res.successCount;
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return deleted;
}

// ─── Storage ───────────────────────────────────────────────────────────────

/**
 * Delete every object in `STORAGE_BUCKET` whose path starts with one of
 * `STORAGE_PATH_PREFIXES`. Other paths are left alone so operator-managed
 * dev fixtures survive a reset.
 *
 * In `--dry-run`, returns the count of objects that WOULD be deleted.
 */
async function processStorage(): Promise<{ deleted: number; perPrefix: Record<string, number> }> {
  const bucket = storage.bucket();
  const perPrefix: Record<string, number> = {};
  let total = 0;

  for (const prefix of STORAGE_PATH_PREFIXES) {
    const [files] = await bucket.getFiles({ prefix, autoPaginate: true });
    perPrefix[prefix] = files.length;

    if (files.length === 0) continue;
    if (DRY_RUN) {
      total += files.length;
      continue;
    }

    // bucket.deleteFiles({ prefix }) would do the same thing in one
    // round-trip, but iterating gives us per-file error visibility
    // and predictable progress in long runs.
    await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
    total += files.length;
  }
  return { deleted: total, perPrefix };
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

async function reset(): Promise<void> {
  const label = PROJECT_LABEL[PROJECT_ID] ?? PROJECT_ID;
  const mode = DRY_RUN ? "DRY-RUN — nothing will be deleted" : "WRITE";
  console.log(
    `\n⚠️  RESET (${mode}): target=${SEED_TARGET}, project=${PROJECT_ID}, label=${label}, bucket=${STORAGE_BUCKET}\n`,
  );

  console.log("📦 Firestore collections:");
  for (const col of RESETTABLE_COLLECTIONS) {
    const count = await processCollection(db, col);
    if (count > 0) {
      const verb = DRY_RUN ? "would delete" : "deleted";
      console.log(`  ✓ ${col.padEnd(28)} — ${verb} ${count} docs`);
    } else {
      console.log(`  · ${col.padEnd(28)} — empty`);
    }
  }

  console.log("\n🔐 Auth users (@teranga.dev):");
  const authCount = await processAuthUsers();
  console.log(
    `  ✓ ${DRY_RUN ? "would delete" : "deleted"} ${authCount} auth users`,
  );

  console.log(`\n🗂️  Storage bucket (${STORAGE_BUCKET}):`);
  const storageRes = await processStorage();
  for (const prefix of STORAGE_PATH_PREFIXES) {
    const count = storageRes.perPrefix[prefix] ?? 0;
    if (count > 0) {
      console.log(
        `  ✓ ${prefix.padEnd(28)} — ${DRY_RUN ? "would delete" : "deleted"} ${count} objects`,
      );
    } else {
      console.log(`  · ${prefix.padEnd(28)} — empty`);
    }
  }
  console.log(`  total storage ${DRY_RUN ? "would delete" : "deleted"}: ${storageRes.deleted}`);

  if (DRY_RUN) {
    console.log("\n✅ Dry-run complete. Re-run without --dry-run to actually delete.\n");
  } else {
    console.log(
      "\n✅ Reset complete. Run `npm run seed` (or `seed:staging`) to repopulate.\n",
    );
  }
}

reset().catch((err) => {
  console.error("❌ Reset failed:", err);
  process.exit(1);
});
