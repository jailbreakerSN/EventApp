/**
 * Reset the Firestore database to an empty state (plans catalog preserved).
 *
 * Designed for the staging refresh flow: run `seed-reset` → `seed-emulators`
 * in that order to wipe everything and re-seed from the current fixture set.
 *
 * Safety rails (all MUST pass before any write):
 *   1. `FIREBASE_PROJECT_ID` is in the `SEED_ALLOW_LIST`
 *      (see scripts/seed/config.ts — production is NOT in the list).
 *   2. `SEED_RESET_CONFIRM=YES_RESET` is set explicitly.
 *   3. For non-emulator targets, additionally require
 *      `CONFIRM_PROJECT=<FIREBASE_PROJECT_ID>` as a typo-catcher — forces
 *      the caller to type the project id they intend to wipe.
 *
 * Usage (local emulators):
 *   SEED_RESET_CONFIRM=YES_RESET npx tsx scripts/seed-reset.ts
 *
 * Usage (staging — gated behind the seed-staging GitHub Actions workflow):
 *   SEED_TARGET=staging \
 *   FIREBASE_PROJECT_ID=teranga-events-staging \
 *   SEED_RESET_CONFIRM=YES_RESET \
 *   CONFIRM_PROJECT=teranga-events-staging \
 *     npx tsx scripts/seed-reset.ts
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

// Extra typo-catcher for real-project targets. Emulator writes are cheap and
// reversible; staging writes require typing the project id a second time.
if (SEED_TARGET !== "emulator") {
  const typed = process.env.CONFIRM_PROJECT;
  if (typed !== PROJECT_ID) {
    throw new Error(
      `CONFIRM_PROJECT mismatch. Set CONFIRM_PROJECT=${PROJECT_ID} to reset project ${PROJECT_ID}.`,
    );
  }
}

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const app = initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);
const auth = getAuth(app);

/**
 * Delete all documents in a single collection, 500 at a time (Firestore's
 * batch write limit). Does NOT recurse into subcollections — the seed
 * doesn't use any subcollections today; add explicit handling here if that
 * ever changes.
 */
async function deleteCollection(
  fs: Firestore,
  collection: string,
  batchSize = 500,
): Promise<number> {
  let totalDeleted = 0;
  for (;;) {
    const snap = await fs.collection(collection).limit(batchSize).get();
    if (snap.empty) return totalDeleted;

    const batch = fs.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    totalDeleted += snap.size;

    // If we got fewer than batchSize, the collection is drained.
    if (snap.size < batchSize) return totalDeleted;
  }
}

/**
 * Delete every seed-created Auth user. Identified by the `@teranga.dev`
 * email suffix — the seed is the only source of users with that domain, so
 * a real participant who happens to sign up with `foo@teranga.dev` would be
 * deleted by this reset. The seed domain is already documented as dev-only.
 */
async function deleteSeedAuthUsers(): Promise<number> {
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

async function reset(): Promise<void> {
  const label = PROJECT_LABEL[PROJECT_ID] ?? PROJECT_ID;
  console.log(
    `\n⚠️  RESET: wiping Firestore (target=${SEED_TARGET}, project=${PROJECT_ID}, label=${label})\n`,
  );

  for (const col of RESETTABLE_COLLECTIONS) {
    const count = await deleteCollection(db, col);
    if (count > 0) {
      console.log(`  ✓ ${col.padEnd(28)} — deleted ${count} docs`);
    } else {
      console.log(`  · ${col.padEnd(28)} — empty`);
    }
  }

  console.log("\n🔐 Clearing seed auth users (@teranga.dev)...");
  const authDeleted = await deleteSeedAuthUsers();
  console.log(`  ✓ ${authDeleted} auth users deleted`);

  console.log(
    "\n✅ Reset complete. Run `npm run seed` (or `seed:staging`) to repopulate.\n",
  );
}

reset().catch((err) => {
  console.error("❌ Reset failed:", err);
  process.exit(1);
});
