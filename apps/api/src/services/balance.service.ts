import {
  type BalanceTransaction,
  type BalanceTransactionQuery,
  type OrganizationBalance,
} from "@teranga/shared-types";
import crypto from "node:crypto";
import { balanceTransactionRepository } from "@/repositories/balance-transaction.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { BaseService } from "./base.service";
import { computeBalance } from "./balance-ledger";
import type { PaginatedResult } from "@/repositories/base.repository";

// ─── Balance Service ─────────────────────────────────────────────────────────
// Read surface: aggregate balance + paginated transactions list (used by
// the /finance page and Transactions tab). All access is gated by
// `payment:view_reports` + `requireOrganizationAccess()` so participants
// can never read another org's ledger.
//
// Write surface: `releaseAvailableFunds()` — graduates `pending` entries
// past their `availableOn` window to `available`. Called from two paths
// that share THIS method as their single source of truth:
//   1. The hourly Cloud Function `releaseAvailableFunds` POSTs to the
//      internal route `/v1/internal/balance/release-available`, which
//      delegates here.
//   2. The admin runner via the `release-available-funds` job handler
//      (operators triggering a manual sweep from /admin/jobs).

/** Firestore batch cap — 500 operations / commit. */
const BATCH_SIZE = 500;

/**
 * Hard cap on entries processed in a single invocation, defending against
 * an accumulated backlog (or a fixture explosion in dev). At BATCH_SIZE
 * 500 and ~50 ms per commit, 50 000 entries fit comfortably within the
 * runner's 5-minute hard timeout AND Cloud Functions' 540s budget.
 */
const MAX_ENTRIES_PER_RUN = 50_000;

/** Cap on `sampleEntryIds` per emitted event — keeps each audit doc << 1 MiB. */
const SAMPLE_ENTRY_IDS_MAX = 50;

/** Result returned by `releaseAvailableFunds`. */
export interface ReleaseAvailableFundsResult {
  released: number;
  organizationsAudited: number;
  asOf: string;
}

/** Optional context passed in by the caller. All fields default safely. */
export interface ReleaseAvailableFundsContext {
  /** Inclusive upper bound on `availableOn`. Defaults to "now" at call time. */
  asOf?: string;
  /** Cap on entries flipped per invocation. Defaults to 50 000. */
  maxEntries?: number;
  /** AbortSignal honoured between Firestore pages. */
  signal?: AbortSignal;
  /**
   * Trigger discriminator — `admin-job:<runId>` for /admin/jobs UI runs,
   * `system:cron-<uuid>` for the hourly Cloud Function. Lets the audit
   * grid filter "manual vs scheduled" cleanly. Defaults to a
   * `system:<uuid>` stamp so no caller can omit attribution.
   */
  runId?: string;
  /** Optional structured logger; defaults to a noop. */
  log?: (event: string, data?: Record<string, unknown>) => void;
}

interface ReleasedEntry {
  id: string;
  organizationId: string;
  amount: number;
}

class BalanceService extends BaseService {
  /**
   * Aggregate balance for an organization. Reads every ledger entry and
   * folds them into the `OrganizationBalance` shape. Single-indexed scan
   * on `organizationId` — cheap for current scale; when we outgrow memory,
   * the right move is a per-org materialised `balanceSummaries/{orgId}`
   * doc maintained by a Pub/Sub listener. Not read-time pagination.
   */
  async getBalance(organizationId: string, user: AuthUser): Promise<OrganizationBalance> {
    this.requirePermission(user, "payment:view_reports");
    this.requireOrganizationAccess(user, organizationId);

    const entries = await balanceTransactionRepository.findAllByOrganization(organizationId);
    return computeBalance(entries, new Date());
  }

  /**
   * Paginated ledger entries for an organization. Used by the Transactions
   * tab on /finance; supports the full filter surface on the
   * `BalanceTransactionQuerySchema` (kind, status, eventId, date range).
   */
  async listTransactions(
    organizationId: string,
    query: BalanceTransactionQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<BalanceTransaction>> {
    this.requirePermission(user, "payment:view_reports");
    this.requireOrganizationAccess(user, organizationId);

    const { page, limit, ...filters } = query;
    return balanceTransactionRepository.findByOrganization(organizationId, filters, {
      page,
      limit,
    });
  }

  /**
   * Sweep `pending` ledger entries whose `availableOn` ≤ `asOf` and flip
   * them to `available`. System-mode — no AuthUser, no per-org scoping.
   *
   * Audit:
   *   - Per-organization summary emitted via
   *     `eventBus.emit("balance_transaction.released", {...})` — listener
   *     writes one row per org per sweep.
   *   - Cron-tick heartbeat via `eventBus.emit("balance.release_swept", {...})`
   *     emitted EXACTLY once per invocation regardless of whether anything
   *     was released. Mirrors `payment.reconciliation_swept` so ops
   *     dashboards can graph release cadence and detect a silently-dead
   *     cron.
   *
   * Race + idempotency:
   *   The transition is `pending → available`. Refunds skip pending (they
   *   write `status: available` directly). Payouts read `available` and
   *   flip to `paid_out`, never touching `pending`. No other writer can
   *   contend on a `pending` row, so a non-transactional batched update
   *   is safe. Concurrent admin-vs-cron invocations may both emit a
   *   per-org released event with the same entry IDs (each path queries
   *   afresh) — this is rare (operator clicks during cron's 5-minute
   *   window) and produces a duplicate audit row, NOT corruption. The
   *   ledger flip itself is idempotent (second update is a no-op).
   *
   * Pagination: each commit removes the page's docs from the candidate
   * pool, so the next iteration's query naturally returns the next-oldest
   * batch. A cursor on `availableOn` is unnecessary AND would risk
   * skipping rows if commits race with concurrent writes elsewhere.
   */
  async releaseAvailableFunds(
    ctx: ReleaseAvailableFundsContext = {},
  ): Promise<ReleaseAvailableFundsResult> {
    const asOf = ctx.asOf ?? new Date().toISOString();
    const cap = Math.min(ctx.maxEntries ?? MAX_ENTRIES_PER_RUN, MAX_ENTRIES_PER_RUN);
    const runId = ctx.runId ?? `system:${crypto.randomUUID()}`;
    const log = ctx.log ?? (() => undefined);

    if (ctx.signal?.aborted) throw new Error("aborted");

    const released = await this.sweepPendingEntries(asOf, cap, ctx.signal);
    log("balance.release.swept", {
      event: "balance.release.swept",
      released: released.length,
      asOf,
      runId,
    });

    // Group released entries by org for the per-org event fan-out.
    const byOrg = new Map<string, ReleasedEntry[]>();
    for (const r of released) {
      const arr = byOrg.get(r.organizationId) ?? [];
      arr.push(r);
      byOrg.set(r.organizationId, arr);
    }

    // Per-org emits — listener at `audit.listener.ts` writes one audit
    // row per emit. Fire-and-forget; the in-process eventBus is sync so
    // failures surface synchronously but don't block the sweep semantics.
    for (const [orgId, entries] of byOrg) {
      const netAmount = entries.reduce((sum, e) => sum + e.amount, 0);
      const sampleEntryIds = entries.slice(0, SAMPLE_ENTRY_IDS_MAX).map((e) => e.id);
      eventBus.emit("balance_transaction.released", {
        organizationId: orgId,
        count: entries.length,
        netAmount,
        sampleEntryIds,
        truncated: entries.length > sampleEntryIds.length,
        runId,
        actorId: "system:balance-release",
        requestId: getRequestId() ?? runId,
        timestamp: asOf,
      });
    }

    // Heartbeat — emit always, even on `released: 0`. Operators graph
    // this to alert on "no successful sweep in N hours".
    eventBus.emit("balance.release_swept", {
      released: released.length,
      organizationsAffected: byOrg.size,
      asOf,
      runId,
      actorId: "system:balance-release",
      requestId: getRequestId() ?? runId,
      timestamp: asOf,
    });

    return {
      released: released.length,
      organizationsAudited: byOrg.size,
      asOf,
    };
  }

  /**
   * Internal — find every `pending` entry whose `availableOn` ≤ `asOf`
   * and flip it to `available` in batched writes of BATCH_SIZE.
   *
   * Honours `signal` between batches so a stuck Firestore page still
   * respects the caller's deadline.
   */
  private async sweepPendingEntries(
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
}

export const balanceService = new BalanceService();
