import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import type { Query, DocumentSnapshot } from "firebase-admin/firestore";
import { db, COLLECTIONS } from "../utils/admin";

// ─── Balance release scheduled job (Phase Finance) ───────────────────────────
//
// Graduates `balanceTransactions` entries from `status: "pending"` to
// `status: "available"` once their `availableOn` window has elapsed.
//
// Why this exists:
//   The /finance page promises "Libéré 7j après la fin de l'événement"
//   (see apps/web-backoffice/src/app/(dashboard)/finance/page.tsx). Without
//   this job, pending entries never graduate — the operator sees their
//   funds locked indefinitely. The release window itself is computed at
//   payment-succeeded time by `computeAvailableOn()` in
//   apps/api/src/config/finance.ts and stored on each ledger entry.
//
// Design:
//   - Single global query on `(status, availableOn)` — no per-org loop on
//     the scan side. Cheap because the index is selective: only `pending`
//     rows past their release date are scanned, and the population shrinks
//     with every run.
//   - Cursor-paginated batched writes (max 500 ops per Firestore batch).
//     Idempotent: re-running with no due entries is a no-op.
//   - One audit row per organization per run, aggregating the count + net
//     amount released. We deliberately DON'T write one audit row per
//     ledger entry — the entries themselves are the audit trail; the
//     scheduler row exists to give Cloud Logging + the admin /audit grid
//     a single "settlement happened" anchor per org per run.
//
// Race + idempotency:
//   The transition is `pending → available`. Refunds skip pending (they
//   write `status: available` directly). Payouts read `available` and
//   flip to `paid_out`, NEVER touching `pending`. No other writer can
//   contend on a `pending` row, so a non-transactional batched update is
//   safe. If the same row were somehow returned by two concurrent
//   scheduler runs, the second update would set `status` to the same
//   value — a harmless no-op.
//
// Schedule:
//   Hourly. The release window is multi-day, so a daily cadence would
//   delay funds by up to 24h past their unlock time. Hourly costs ~24
//   small queries/day across the platform — negligible. Aligns with how
//   Stripe surfaces "available balance" to merchants in near-real-time.

/** Firestore batch cap — 500 operations / commit. */
const BATCH_SIZE = 500;

/**
 * Hard cap on entries processed in a single run, defending against an
 * accumulated backlog (or a fixture explosion in dev). At BATCH_SIZE
 * 500 and ~50ms per commit, 50_000 entries fit comfortably within the
 * 540s timeout while leaving headroom for audit-log writes.
 */
const MAX_ENTRIES_PER_RUN = 50_000;

interface ReleasedEntry {
  id: string;
  organizationId: string;
  amount: number;
}

export const releaseAvailableFunds = onSchedule(
  {
    region: "europe-west1",
    schedule: "0 * * * *", // top of every hour
    timeZone: "Africa/Dakar",
    memory: "256MiB",
    maxInstances: 1, // single-writer; concurrent runs would just contend
    timeoutSeconds: 540,
  },
  async () => {
    const start = Date.now();
    const now = new Date(start);
    const nowIso = now.toISOString();

    const released = await sweepPendingEntries(nowIso);

    if (released.length === 0) {
      logger.info("Balance release: no entries due", { nowIso });
      return;
    }

    const auditRows = await writeReleaseAuditLogs(released, nowIso);

    logger.info("Balance release complete", {
      nowIso,
      released: released.length,
      organizations: auditRows,
      durationMs: Date.now() - start,
    });
  },
);

/**
 * Find every `pending` entry whose `availableOn` is <= now and flip it to
 * `available` in batched writes of BATCH_SIZE. Returns the list of
 * (id, organizationId, amount) so the caller can build per-org audit rows.
 *
 * Pagination: each commit removes the page's docs from the candidate
 * pool (their `status` is no longer `pending`), so the next iteration's
 * query naturally returns the next-oldest batch. A cursor on
 * `availableOn` is unnecessary AND would risk skipping rows if commits
 * race with new writes elsewhere.
 */
async function sweepPendingEntries(nowIso: string): Promise<ReleasedEntry[]> {
  const released: ReleasedEntry[] = [];
  let lastDoc: DocumentSnapshot | undefined;

  while (released.length < MAX_ENTRIES_PER_RUN) {
    let query: Query = db
      .collection(COLLECTIONS.BALANCE_TRANSACTIONS)
      .where("status", "==", "pending")
      .where("availableOn", "<=", nowIso)
      .orderBy("availableOn", "asc")
      .limit(BATCH_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) {
      const data = doc.data() as {
        organizationId: string;
        amount: number;
      };
      batch.update(doc.ref, { status: "available" });
      released.push({
        id: doc.id,
        organizationId: data.organizationId,
        amount: typeof data.amount === "number" ? data.amount : 0,
      });
    }
    await batch.commit();

    if (snap.size < BATCH_SIZE) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  if (released.length >= MAX_ENTRIES_PER_RUN) {
    // Backlog larger than a single run can drain. The next hourly run
    // will continue from where this one stopped (the cap is on count,
    // not time) — log a warning so operators notice if this becomes
    // chronic and need to size up the job.
    logger.warn(
      "Balance release hit MAX_ENTRIES_PER_RUN cap; backlog will drain over future runs",
      {
        cap: MAX_ENTRIES_PER_RUN,
      },
    );
  }

  return released;
}

/**
 * Aggregate released entries by organizationId and write one audit row
 * per org. The row carries the count + signed net amount (sum across
 * all kinds — payment credits net of platform_fee debits) + a capped
 * sample of entry IDs for forensics. Sample is capped at 50 to keep
 * the audit doc under Firestore's 1 MiB limit even on pathological orgs.
 *
 * Returns the number of organizations audited (one row each).
 */
async function writeReleaseAuditLogs(released: ReleasedEntry[], nowIso: string): Promise<number> {
  const byOrg = new Map<string, ReleasedEntry[]>();
  for (const r of released) {
    const arr = byOrg.get(r.organizationId) ?? [];
    arr.push(r);
    byOrg.set(r.organizationId, arr);
  }

  // Audit writes use a single batched commit per BATCH_SIZE orgs. Most
  // runs touch only a handful of orgs so this is usually a single batch.
  const orgs = [...byOrg.entries()];
  for (let i = 0; i < orgs.length; i += BATCH_SIZE) {
    const slice = orgs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const [orgId, entries] of slice) {
      const netAmount = entries.reduce((sum, e) => sum + e.amount, 0);
      const sampleEntryIds = entries.slice(0, 50).map((e) => e.id);

      const auditRef = db.collection(COLLECTIONS.AUDIT_LOGS).doc();
      batch.set(auditRef, {
        action: "balance_transaction.released",
        actorId: "system:balance-release-scheduler",
        actorDisplayName: null,
        requestId: `balance-release-${nowIso}`,
        timestamp: nowIso,
        resourceType: "organization",
        resourceId: orgId,
        eventId: null,
        organizationId: orgId,
        details: {
          count: entries.length,
          netAmount,
          sampleEntryIds,
          truncated: entries.length > sampleEntryIds.length,
        },
      });
    }
    await batch.commit();
  }

  return byOrg.size;
}
