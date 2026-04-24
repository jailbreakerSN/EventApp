import { z } from "zod";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { type JobHandler } from "../types";

/**
 * `prune-expired-invites` — flips expired `pending` invites to
 * `status: "expired"`.
 *
 * Invites carry a hard `expiresAt` ISO timestamp; once past, they
 * should no longer be acceptable. The invite-accept route already
 * rejects expired rows on the fly, so this handler is for cleanliness
 * and audit hygiene (a stale "pending" row that silently never gets
 * accepted looks like a bug). Idempotent — re-running is a no-op.
 *
 * Scope: ALL organizations. One atomic commit per batch of ≤ 400 rows
 * (Firestore `writeBatch` hard cap is 500; leaving headroom for the
 * audit log writes is deferred to the domain-event bus). Respects the
 * AbortSignal between batches so a long sweep honours the 5-minute
 * cap.
 *
 * Future: when invite volume grows, switch to a Firestore scheduled
 * function. For now this is the explicit-trigger path.
 */

const inputSchema = z
  .object({
    /**
     * Cap on rows processed in one invocation. Defaults to 1000 so
     * the worst-case is roughly 3 round-trips × 400 rows. Higher
     * values are allowed but discouraged — a Cloud Run request
     * that runs for 4 minutes tying up a pod is not polite.
     */
    maxRows: z.coerce.number().int().positive().max(10_000).default(1000),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const BATCH_SIZE = 400;

export const pruneExpiredInvitesHandler: JobHandler<Input> = {
  descriptor: {
    jobKey: "prune-expired-invites",
    titleFr: "Purger les invitations expirées",
    titleEn: "Prune expired invites",
    descriptionFr:
      "Passe tous les `invites.status = pending` dont `expiresAt` est dépassé à `status = expired`. Idempotent.",
    descriptionEn:
      "Flips every pending invite whose `expiresAt` is in the past to `status = expired`. Idempotent.",
    hasInput: true,
    exampleInput: { maxRows: 1000 },
    dangerNoteFr: null,
    dangerNoteEn: null,
  },
  inputSchema,
  run: async (input: Input, ctx) => {
    const nowIso = new Date().toISOString();
    let processed = 0;
    let flipped = 0;
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    // Paginated cursor scan so we never build a single giant query.
    // The composite index (status, expiresAt) is already declared in
    // firestore.indexes.json for the invite-list UI; we reuse it here.
    while (processed < input.maxRows) {
      if (ctx.signal.aborted) {
        ctx.log("prune.aborted", { processed, flipped });
        throw new Error("aborted");
      }

      let query = db
        .collection(COLLECTIONS.INVITES)
        .where("status", "==", "pending")
        .where("expiresAt", "<", nowIso)
        .orderBy("expiresAt", "asc")
        .limit(Math.min(BATCH_SIZE, input.maxRows - processed));
      if (cursor) query = query.startAfter(cursor);

      const snap = await query.get();
      if (snap.empty) break;

      const batch = db.batch();
      const batchStartCount = flipped;
      for (const doc of snap.docs) {
        batch.update(doc.ref, { status: "expired", updatedAt: nowIso });
        flipped += 1;
      }
      await batch.commit();
      processed += snap.docs.length;
      cursor = snap.docs[snap.docs.length - 1] ?? null;

      // Emit ONE domain event per committed batch (not per invite) so
      // the audit listener captures the bulk mutation without
      // ballooning into thousands of events. Tagged with runId so the
      // audit trail can join the invite update back to the admin who
      // triggered it. Mirrors the `checkin.bulk_synced` pattern.
      eventBus.emit("invite.bulk_expired", {
        actorUid: ctx.actor.uid,
        jobKey: "prune-expired-invites",
        runId: ctx.runId,
        count: flipped - batchStartCount,
        processedAt: nowIso,
      });

      ctx.log("prune.batch_committed", { processed, flipped });

      // Short-circuit if the page was partial — no more matching rows.
      if (snap.docs.length < BATCH_SIZE) break;
    }

    return `Expired ${flipped} invite(s) — processed ${processed} row(s).`;
  },
};
