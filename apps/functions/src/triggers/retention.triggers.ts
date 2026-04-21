import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import type { Query, DocumentSnapshot } from "firebase-admin/firestore";
import { db, COLLECTIONS } from "../utils/admin";

// Retention policy scheduled job (Phase 3c.5).
//
// Runs daily at 03:00 Africa/Dakar (off-peak for the Senegalese market)
// and prunes data that no longer has a legal or operational reason to
// stick around. Skill source:
//   .agents/skills/email-best-practices/references/list-management.md
//
// Current policies (see RETENTION_DAYS below)
//   - pending newsletterSubscribers older than 30d → delete
//     (user started double-opt-in but never confirmed — no consent on
//     file, so GDPR "keep only as long as necessary" kicks in)
//   - emailLog rows older than 90d → delete
//     (send attempts / delivery status; skill recommends 90 days)
//
// Preserved indefinitely (documented, not pruned)
//   - emailSuppressions: hard bounces + complaints — never delete, per
//     skill + deliverability floor (skill #list-management.md)
//   - auditLogs: 3-year CASL floor for consent trail. Not touched here;
//     any future audit-log pruning belongs in a separate job with a
//     hard floor of 3 years on newsletter.subscriber_confirmed rows
//   - confirmed + unsubscribed subscribers: their audit trail counts as
//     the consent record; keep the row so a CSV export or re-engagement
//     campaign has it
//
// Idempotent: re-running finds nothing new to delete.
// Safe to run concurrently with other writes; each batch commit is
// atomic and deletions don't interact with subscribe/confirm flows.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_SUBSCRIBER_MAX_AGE_DAYS = 30;
const EMAIL_LOG_MAX_AGE_DAYS = 90;

/** Firestore batch cap. */
const BATCH_SIZE = 500;

export const runRetentionPolicies = onSchedule(
  {
    region: "europe-west1",
    schedule: "0 3 * * *", // daily 03:00
    timeZone: "Africa/Dakar",
    memory: "256MiB",
    maxInstances: 1,
    // Longer timeout than the default 60s: if a collection has accumulated
    // a significant backlog the first run will pull through several
    // paginated batches. 9 minutes leaves headroom without approaching
    // Cloud Functions' hard 540s cap.
    timeoutSeconds: 540,
  },
  async () => {
    const start = Date.now();
    const pendingCutoff = new Date(
      start - PENDING_SUBSCRIBER_MAX_AGE_DAYS * ONE_DAY_MS,
    ).toISOString();
    const emailLogCutoff = new Date(start - EMAIL_LOG_MAX_AGE_DAYS * ONE_DAY_MS).toISOString();

    const pendingSubscribersPruned = await pruneOldPendingSubscribers(pendingCutoff);
    const emailLogsPruned = await pruneOldEmailLogs(emailLogCutoff);

    logger.info("Retention policy run complete", {
      pendingSubscribersPruned,
      emailLogsPruned,
      pendingCutoff,
      emailLogCutoff,
      durationMs: Date.now() - start,
    });
  },
);

/**
 * Prune `newsletterSubscribers` docs where `status === "pending"` AND
 * `createdAt < cutoff`. Confirmed and unsubscribed rows are preserved
 * as the consent trail (3-year CASL floor).
 *
 * The age filter runs at the query level (indexed, no extra composite
 * index needed because it's a single-field inequality). The status
 * filter runs in-memory — cheap at our volumes (pending rows are a
 * small subset; most users confirm within minutes or abandon) and
 * avoids introducing a (status, createdAt) composite index.
 *
 * Cursor-paginated: we always walk forward via startAfter even when
 * some docs in a page were skipped, so we never re-examine the same
 * confirmed row twice.
 */
async function pruneOldPendingSubscribers(cutoffIso: string): Promise<number> {
  let total = 0;
  let lastDoc: DocumentSnapshot | undefined;

  while (true) {
    let query: Query = db
      .collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS)
      .where("createdAt", "<", cutoffIso)
      .orderBy("createdAt")
      .limit(BATCH_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batched = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as { status?: string };
      if (data.status === "pending") {
        batch.delete(doc.ref);
        batched++;
      }
    }
    if (batched > 0) await batch.commit();
    total += batched;

    if (snap.size < BATCH_SIZE) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  return total;
}

/**
 * Delete `emailLog` rows older than the cutoff. No status filter —
 * every email-log entry is fair game once it passes 90 days. The
 * suppression list (written separately by resendWebhook) is not
 * touched.
 */
async function pruneOldEmailLogs(cutoffIso: string): Promise<number> {
  let total = 0;

  // No cursor needed here: each commit deletes the full page, so the
  // next query with the same `createdAt < cutoff` filter + orderBy
  // will return the next-oldest batch.
  while (true) {
    const snap = await db
      .collection(COLLECTIONS.EMAIL_LOG)
      .where("createdAt", "<", cutoffIso)
      .orderBy("createdAt")
      .limit(BATCH_SIZE)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();

    total += snap.size;
    if (snap.size < BATCH_SIZE) break;
  }

  return total;
}
