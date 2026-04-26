import { z } from "zod";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { type JobHandler } from "../types";

/**
 * `expire-stale-payments` — flips long-stale `pending` / `processing`
 * payments to `status: "expired"` and cancels the corresponding
 * pending_payment registration row.
 *
 * P1-21 (audit L1) — closes the gap left open by the previously
 * "defined-but-never-assigned" `expired` status. A payment that sits
 * in `pending` (the user never completed the redirect) or `processing`
 * (the provider never sent its webhook) for longer than the staleness
 * window is conclusively never going to succeed:
 *
 *   - Wave checkout sessions auto-expire after ~30 min on Wave's side.
 *   - Orange Money pay tokens expire after the OAuth grace window
 *     (typically 1 h).
 *   - PayDunya invoices expire after ~24 h.
 *
 * 24 h covers all three providers with comfortable margin. After that
 * window, the row is forensic noise on the operator dashboard at best
 * and an active footgun at worst (a stuck `pending_payment` blocks the
 * user from re-registering for the same event because of the
 * duplicate-registration guard). The cleanup releases both surfaces.
 *
 * Idempotency: re-running the job on an already-expired payment is a
 * no-op — the `status IN ['pending','processing']` filter excludes
 * terminal rows, so a second pass over the same window does nothing
 * and emits no events.
 *
 * Companion observer events:
 *   - `payment.bulk_expired` (one per committed batch) for the audit
 *     listener and the operator-dashboard timeline. Tagged with
 *     `runId` so the audit trail can join run → bulk emit.
 *
 * Ops:
 *   - Trigger via POST /v1/admin/jobs/expire-stale-payments/run.
 *   - Default cutoff: 24 h. Override `staleAfterHours` for forensics
 *     (e.g. emergency cleanup of a 3-day backlog after a provider
 *     outage).
 *   - Default `maxRows`: 1000 (3 × 400 row batches worst case).
 *   - 5-minute timeout enforced by the runner; honour `ctx.signal`
 *     between batches.
 */

const inputSchema = z
  .object({
    /**
     * Hours since `initiatedAt` after which a non-terminal payment is
     * considered stale. Defaults to 24 (covers Wave + OM + PayDunya
     * session windows). Range capped at 720 h (30 d) so an operator
     * mistake can't sweep the whole history table.
     */
    staleAfterHours: z.coerce.number().int().positive().max(720).default(24),
    /**
     * Cap on rows processed in one invocation. Defaults to 1000 so
     * the worst-case is roughly 3 round-trips × 400 rows. Higher
     * values are allowed but discouraged — a Cloud Run request that
     * runs for 4 minutes tying up a pod is not polite.
     */
    maxRows: z.coerce.number().int().positive().max(10_000).default(1000),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const BATCH_SIZE = 400;

export const expireStalePaymentsHandler: JobHandler<Input> = {
  descriptor: {
    jobKey: "expire-stale-payments",
    titleFr: "Expirer les paiements obsolètes",
    titleEn: "Expire stale payments",
    descriptionFr:
      "Passe les paiements `pending` ou `processing` plus vieux que `staleAfterHours` (par défaut 24 h) à `status = expired`, et annule l'inscription en attente associée. Idempotent.",
    descriptionEn:
      "Flips `pending` / `processing` payments older than `staleAfterHours` (default 24 h) to `status = expired`, and cancels the matching pending_payment registration. Idempotent.",
    hasInput: true,
    exampleInput: { staleAfterHours: 24, maxRows: 1000 },
    dangerNoteFr:
      "À utiliser avec précaution sur des fenêtres < 1 h — un paiement encore en cours peut être annulé prématurément.",
    dangerNoteEn:
      "Use with care below 1 h — an in-flight payment may be cancelled prematurely.",
  },
  inputSchema,
  run: async (input: Input, ctx) => {
    const nowIso = new Date().toISOString();
    const cutoffMs = Date.now() - input.staleAfterHours * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    let processed = 0;
    let flipped = 0;
    // Cursor-paginated scan — matches the prune-expired-invites
    // handler's shape so a future caller can swap one for the other
    // without learning a new pattern. Both `status IN ['pending',
    // 'processing']` AND `initiatedAt < cutoff` resolved server-side
    // for index efficiency. The composite index is declared in
    // firestore.indexes.json (status × initiatedAt asc).
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    while (processed < input.maxRows) {
      if (ctx.signal.aborted) {
        ctx.log("expire.aborted", { processed, flipped });
        throw new Error("aborted");
      }

      let query = db
        .collection(COLLECTIONS.PAYMENTS)
        .where("status", "in", ["pending", "processing"])
        .where("initiatedAt", "<", cutoffIso)
        .orderBy("initiatedAt", "asc")
        .limit(Math.min(BATCH_SIZE, input.maxRows - processed));
      if (cursor) query = query.startAfter(cursor);

      const snap = await query.get();
      if (snap.empty) break;

      // Use writeBatch instead of a transaction: each payment + its
      // registration form an independent pair, no read-then-write
      // dependency. Atomicity is per-batch (≤ 400 ops); a partial
      // failure aborts the whole batch and the next sweep retries
      // the un-flipped rows. The 500-op Firestore cap on writeBatch
      // is respected by the BATCH_SIZE = 400 cap (200 payment writes
      // + 200 registration writes worst case).
      const batch = db.batch();
      const batchStartCount = flipped;
      for (const doc of snap.docs) {
        const payment = doc.data() as { registrationId?: string };
        batch.update(doc.ref, {
          status: "expired",
          updatedAt: nowIso,
          failureReason: "Paiement expiré : aucun retour fournisseur après le délai imparti",
        });
        if (payment.registrationId) {
          // Release the pending_payment registration so the user can
          // re-register. registeredCount + ticketTypes.soldCount were
          // never incremented on the success path (only handleWebhook
          // succeeds bumps them) so no counter rollback is needed.
          const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(payment.registrationId);
          batch.update(regRef, {
            status: "cancelled",
            updatedAt: nowIso,
          });
        }
        flipped += 1;
      }
      await batch.commit();
      processed += snap.docs.length;
      cursor = snap.docs[snap.docs.length - 1] ?? null;

      // One domain event per batch (not per row) so the audit
      // listener captures the bulk mutation without ballooning into
      // thousands of events. Tagged with runId so the audit trail
      // can join the payment update back to the admin who triggered
      // it. Mirrors the `invite.bulk_expired` pattern.
      eventBus.emit("payment.bulk_expired", {
        actorUid: ctx.actor.uid,
        jobKey: "expire-stale-payments",
        runId: ctx.runId,
        count: flipped - batchStartCount,
        cutoffIso,
        processedAt: nowIso,
      });

      ctx.log("expire.batch_committed", { processed, flipped });

      // Short-circuit if the page was partial — no more matching rows.
      if (snap.docs.length < BATCH_SIZE) break;
    }

    return `Expired ${flipped} payment(s) — processed ${processed} row(s) older than ${input.staleAfterHours} h.`;
  },
};
