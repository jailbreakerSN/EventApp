import { z } from "zod";
import { db, COLLECTIONS } from "@/config/firebase";
import { type JobHandler } from "../types";

/**
 * `release-available-funds` — graduates `balanceTransactions` entries from
 * `status: "pending"` to `status: "available"` once their `availableOn`
 * window has elapsed.
 *
 * Why this lives here:
 *   The /finance page promises "Libéré 7j après la fin de l'événement"
 *   (see apps/web-backoffice/src/app/(dashboard)/finance/page.tsx). Without
 *   this transition firing, pending entries never graduate — operators see
 *   their funds locked indefinitely. The release window itself is computed
 *   at payment-succeeded time by `computeAvailableOn()` in
 *   apps/api/src/config/finance.ts and stored on each ledger entry.
 *
 * Two callers share the `runReleaseSweep` core function below:
 *   1. The hourly Cloud Function `releaseAvailableFunds` (see
 *      apps/functions/src/triggers/balance.triggers.ts) hits the internal
 *      endpoint `POST /v1/internal/balance/release-available`, which calls
 *      `runReleaseSweep` directly.
 *   2. Manual invocation from the admin /admin/jobs UI goes through the
 *      runner → this handler's `run()` → `runReleaseSweep`. Same logic,
 *      different audit envelope (the runner adds `admin.job_triggered`
 *      and `admin.job_completed` rows around the per-org audit rows).
 *
 * Race + idempotency:
 *   The transition is `pending → available`. Refunds skip pending (they
 *   write `status: available` directly via appendLedgerEntry's refund
 *   branch). Payouts read `available` and flip to `paid_out`, never
 *   touching `pending`. No other writer can contend on a `pending` row,
 *   so a non-transactional batched update is safe. The admin runner's
 *   single-flight lock prevents concurrent admin runs; `maxInstances: 1`
 *   on the cron prevents concurrent scheduled runs; the two paths can
 *   in theory overlap but the worst case is a no-op double-update of an
 *   already-released row.
 *
 * Audit:
 *   `runReleaseSweep` emits one `balance_transaction.released` audit row
 *   per organization per invocation (count + signed netAmount + capped
 *   sample of entry IDs for forensics).
 */

/** Firestore batch cap — 500 operations / commit. */
const BATCH_SIZE = 500;

/**
 * Hard cap on entries processed in a single invocation, defending against
 * an accumulated backlog (or a fixture explosion in dev). At BATCH_SIZE
 * 500 and ~50ms per commit, 50_000 entries fit comfortably within the
 * runner's 5-minute hard timeout AND Cloud Functions' 540s budget.
 */
const MAX_ENTRIES_PER_RUN = 50_000;

/** Cap on `sampleEntryIds` per audit row — keeps each audit doc << 1 MiB. */
const SAMPLE_ENTRY_IDS_MAX = 50;

const inputSchema = z
  .object({
    /**
     * Override the inclusive upper bound on `availableOn`. Defaults to
     * the current wall clock. Useful for back-dated dry-runs or for
     * deliberately deferring the release.
     */
    asOf: z.string().datetime().optional(),
    /**
     * Cap on entries flipped per invocation. Defaults to 50_000.
     * Lower values are useful for dry-runs / partial sweeps in
     * staging.
     */
    maxEntries: z.coerce.number().int().positive().max(MAX_ENTRIES_PER_RUN).optional(),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

/** Result returned by `runReleaseSweep` to both callers. */
export interface ReleaseSweepResult {
  released: number;
  organizationsAudited: number;
  asOf: string;
}

/** Optional context passed in by the caller. All fields are no-ops when absent. */
export interface ReleaseSweepContext {
  /** AbortSignal honoured between Firestore pages. */
  signal?: AbortSignal;
  /** Tag for the audit `requestId` field — joins per-org rows back to the trigger run. */
  runId?: string;
  /** Optional structured logger; defaults to a noop. */
  log?: (event: string, data?: Record<string, unknown>) => void;
}

interface ReleasedEntry {
  id: string;
  organizationId: string;
  amount: number;
}

/**
 * Single source of truth for the pending → available sweep. Called by
 * both the admin handler (manual UI trigger) and the internal cron
 * endpoint (system trigger).
 */
export async function runReleaseSweep(
  input: Input,
  ctx: ReleaseSweepContext = {},
): Promise<ReleaseSweepResult> {
  const asOf = input.asOf ?? new Date().toISOString();
  const cap = input.maxEntries ?? MAX_ENTRIES_PER_RUN;
  const runId = ctx.runId ?? `system:${new Date().getTime()}`;
  const log = ctx.log ?? (() => undefined);

  if (ctx.signal?.aborted) throw new Error("aborted");

  const released = await sweepPendingEntries(asOf, cap, ctx.signal);
  log("balance.release.swept", { released: released.length, asOf });

  if (released.length === 0) {
    return { released: 0, organizationsAudited: 0, asOf };
  }

  const organizationsAudited = await writeReleaseAuditLogs(released, asOf, runId);

  return { released: released.length, organizationsAudited, asOf };
}

export const releaseAvailableFundsHandler: JobHandler<Input> = {
  descriptor: {
    jobKey: "release-available-funds",
    titleFr: "Libérer les fonds disponibles",
    titleEn: "Release available funds",
    descriptionFr:
      "Passe les entrées `pending` du grand livre dont la fenêtre `availableOn` est écoulée à `status = available`. Une ligne d'audit par organisation. Idempotent.",
    descriptionEn:
      "Graduates `pending` ledger entries whose `availableOn` window has elapsed to `status = available`. One audit row per organization. Idempotent.",
    hasInput: true,
    exampleInput: {},
    dangerNoteFr: null,
    dangerNoteEn: null,
  },
  inputSchema,
  run: async (input: Input, ctx) => {
    const result = await runReleaseSweep(input, {
      signal: ctx.signal,
      runId: `admin-job:${ctx.runId}`,
      log: ctx.log,
    });

    if (result.released === 0) {
      return `No pending balance entries due as of ${result.asOf}.`;
    }
    return (
      `Released ${result.released} ledger entries across ${result.organizationsAudited} ` +
      `organization(s) (asOf=${result.asOf}).`
    );
  },
};

/**
 * Find every `pending` entry whose `availableOn` is <= `asOf` and flip
 * it to `available` in batched writes of BATCH_SIZE.
 *
 * Pagination: each commit removes the page's docs from the candidate
 * pool (their `status` is no longer `pending`), so the next iteration's
 * query naturally returns the next-oldest batch. A cursor on
 * `availableOn` is unnecessary AND would risk skipping rows if commits
 * race with new writes elsewhere. Honours `signal` between pages.
 */
async function sweepPendingEntries(
  asOf: string,
  cap: number,
  signal?: AbortSignal,
): Promise<ReleasedEntry[]> {
  const released: ReleasedEntry[] = [];

  while (released.length < cap) {
    if (signal?.aborted) throw new Error("aborted");

    const remaining = cap - released.length;
    const pageSize = Math.min(BATCH_SIZE, remaining);

    const snap = await db
      .collection(COLLECTIONS.BALANCE_TRANSACTIONS)
      .where("status", "==", "pending")
      .where("availableOn", "<=", asOf)
      .orderBy("availableOn", "asc")
      .limit(pageSize)
      .get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) {
      const data = doc.data() as { organizationId: string; amount: number };
      batch.update(doc.ref, { status: "available" });
      released.push({
        id: doc.id,
        organizationId: data.organizationId,
        amount: typeof data.amount === "number" ? data.amount : 0,
      });
    }
    await batch.commit();

    if (snap.size < pageSize) break;
  }

  return released;
}

/**
 * Aggregate released entries by organizationId and write one audit row
 * per org. The row carries the count + signed net amount + a capped
 * sample of entry IDs for forensics. Sample is capped at 50 to keep
 * the audit doc under Firestore's 1 MiB limit on pathological orgs.
 *
 * Returns the number of organizations audited (one row each).
 */
async function writeReleaseAuditLogs(
  released: ReleasedEntry[],
  asOf: string,
  runId: string,
): Promise<number> {
  const byOrg = new Map<string, ReleasedEntry[]>();
  for (const r of released) {
    const arr = byOrg.get(r.organizationId) ?? [];
    arr.push(r);
    byOrg.set(r.organizationId, arr);
  }

  const orgs = [...byOrg.entries()];
  for (let i = 0; i < orgs.length; i += BATCH_SIZE) {
    const slice = orgs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const [orgId, entries] of slice) {
      const netAmount = entries.reduce((sum, e) => sum + e.amount, 0);
      const sampleEntryIds = entries.slice(0, SAMPLE_ENTRY_IDS_MAX).map((e) => e.id);

      const auditRef = db.collection(COLLECTIONS.AUDIT_LOGS).doc();
      batch.set(auditRef, {
        action: "balance_transaction.released",
        actorId: "system:balance-release",
        actorDisplayName: null,
        requestId: runId,
        timestamp: asOf,
        resourceType: "organization",
        resourceId: orgId,
        eventId: null,
        organizationId: orgId,
        details: {
          count: entries.length,
          netAmount,
          sampleEntryIds,
          truncated: entries.length > sampleEntryIds.length,
          runId,
        },
      });
    }
    await batch.commit();
  }

  return byOrg.size;
}
