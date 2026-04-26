/**
 * Backfill searchKeywords[] on every existing event document.
 *
 * P0.2 of the data-listing doctrine
 * (see `docs/design-system/data-listing.md` § Backend primitives).
 * Once `searchKeywords` is mandatory at write time, this script catches every
 * pre-doctrine event so participant `/events?q=…` returns results from before
 * the migration too.
 *
 * Behavior:
 *  - Fetches every document in `events/` in batches of 500.
 *  - For each event, recomputes `searchKeywords` from
 *    (title × 3, tags × 2, location.city × 1, location.country × 1) via
 *    `buildSearchKeywords` (the same helper the runtime service uses).
 *  - Writes via batched updates (Firestore caps at 500 ops/batch).
 *  - Idempotent: re-running overwrites the field with a freshly computed
 *    array. Safe to run repeatedly (e.g. after the doctrine adds a new
 *    contributing field).
 *  - Logs a summary: total scanned, total updated, total skipped (no
 *    indexable fields), total errors.
 *
 * Usage:
 *   # Against emulators (default — uses FIRESTORE_EMULATOR_HOST)
 *   npx tsx scripts/backfill-event-search-keywords.ts
 *
 *   # Against a real project — requires ADC / GOOGLE_APPLICATION_CREDENTIALS
 *   SEED_TARGET=staging FIREBASE_PROJECT_ID=teranga-app-990a8 \
 *     npx tsx scripts/backfill-event-search-keywords.ts
 *
 *   # Dry-run (no writes, prints diff samples for the first 10 events)
 *   DRY_RUN=1 npx tsx scripts/backfill-event-search-keywords.ts
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { buildSearchKeywords } from "@teranga/shared-types";

const DRY_RUN = process.env.DRY_RUN === "1";
const BATCH_SIZE = 500;

interface EventDoc {
  title?: string;
  tags?: string[];
  location?: { city?: string; country?: string };
  searchKeywords?: string[];
}

function ensureFirebaseInitialized(): Firestore {
  if (getApps().length === 0) {
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID ?? "demo-teranga",
    });
  }
  return getFirestore();
}

function buildKeywordsForEvent(evt: EventDoc): string[] {
  return buildSearchKeywords([
    { weight: 3, text: evt.title },
    { weight: 2, text: evt.tags?.length ? evt.tags.join(" ") : undefined },
    { weight: 1, text: evt.location?.city },
    { weight: 1, text: evt.location?.country },
  ]);
}

async function main(): Promise<void> {
  const db = ensureFirebaseInitialized();
  const snap = await db.collection("events").get();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let batch = db.batch();
  let pendingInBatch = 0;

  process.stdout.write(`[backfill] scanning ${snap.size} events…\n`);

  for (const doc of snap.docs) {
    scanned++;
    try {
      const data = doc.data() as EventDoc;
      const next = buildKeywordsForEvent(data);

      if (next.length === 0) {
        skipped++;
        continue;
      }

      const prev = data.searchKeywords ?? [];
      if (prev.length === next.length && prev.every((k, i) => k === next[i])) {
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        if (updated < 10) {
          process.stdout.write(
            `[dry-run] ${doc.id} ("${(data.title ?? "<untitled>").slice(0, 40)}"): ${prev.length} → ${next.length} keywords\n`,
          );
        }
        updated++;
        continue;
      }

      batch.update(doc.ref, { searchKeywords: next });
      pendingInBatch++;
      updated++;

      if (pendingInBatch >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        pendingInBatch = 0;
        process.stdout.write(`[backfill] committed batch — ${updated}/${snap.size}\n`);
      }
    } catch (err) {
      errors++;
      process.stderr.write(`[backfill] ${doc.id}: ${(err as Error).message}\n`);
    }
  }

  if (!DRY_RUN && pendingInBatch > 0) {
    await batch.commit();
  }

  process.stdout.write(
    `[backfill] done — scanned=${scanned} updated=${updated} skipped=${skipped} errors=${errors}${DRY_RUN ? " (DRY_RUN)" : ""}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[backfill] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
