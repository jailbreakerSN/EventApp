import { type BalanceTransaction, type BalanceTransactionQuery } from "@teranga/shared-types";
import { BaseRepository, type PaginatedResult } from "./base.repository";
import { COLLECTIONS } from "@/config/firebase";
import { AppError } from "@/errors/app-error";

// Upper bound on entries a single /balance call will fold in memory.
// Sized so a 512 MiB Cloud Run instance has generous headroom (each
// entry ~= 500 B serialised; 50k entries ~= 25 MiB JSON). When an org
// crosses this threshold the right move is a materialised
// `balanceSummaries/{orgId}` doc, NOT lifting the cap.
const MAX_BALANCE_ENTRIES = 50_000;

export class BalanceLedgerTooLargeError extends AppError {
  constructor(organizationId: string, limit: number) {
    super({
      code: "INTERNAL_ERROR",
      // 503 — not 500. The server is healthy; this specific org's ledger
      // is past the on-the-fly fold threshold and needs the materialised
      // summary infrastructure before it can be served.
      statusCode: 503,
      message: `Le grand livre de l'organisation ${organizationId} dépasse la limite de calcul en ligne (${limit} entrées). Un résumé agrégé est requis.`,
      details: { organizationId, limit },
    });
  }
}

// ─── Balance-Transaction Repository ──────────────────────────────────────────
//
// Reads are always scoped by `organizationId` — it's the single query axis
// for the /finance page and any scheduler that computes per-org balances.
// Writes happen exclusively inside domain-service transactions (see
// payment.service / payout.service); callers must use `tx.set(...)` directly,
// never this repository's `.create()` outside a transaction. No runtime guard
// for that — it's enforced by code review + tests.

class BalanceTransactionRepository extends BaseRepository<BalanceTransaction> {
  constructor() {
    super(COLLECTIONS.BALANCE_TRANSACTIONS, "BalanceTransaction");
  }

  /**
   * List ledger entries for an organization, newest-first. Supports all the
   * filter dimensions the /finance UI needs (by kind, status, event, date
   * range). Cursors on `createdAt` descending.
   */
  async findByOrganization(
    organizationId: string,
    filters: Omit<BalanceTransactionQuery, "page" | "limit">,
    pagination: { page: number; limit: number },
  ): Promise<PaginatedResult<BalanceTransaction>> {
    let query = this.collection.where(
      "organizationId",
      "==",
      organizationId,
    ) as FirebaseFirestore.Query;

    if (filters.kind) query = query.where("kind", "==", filters.kind);
    if (filters.status) query = query.where("status", "==", filters.status);
    if (filters.eventId) query = query.where("eventId", "==", filters.eventId);
    if (filters.dateFrom) query = query.where("createdAt", ">=", filters.dateFrom);
    if (filters.dateTo) query = query.where("createdAt", "<=", filters.dateTo);

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    const offset = (pagination.page - 1) * pagination.limit;
    const snap = await query
      .orderBy("createdAt", "desc")
      .offset(offset)
      .limit(pagination.limit)
      .get();

    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BalanceTransaction);

    return {
      data,
      meta: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit),
      },
    };
  }

  /**
   * Fetch every ledger entry for an organization (unpaginated). Used by the
   * balance-summary endpoint — the operator-scale fleet (tens of thousands
   * of entries worst-case) fits in memory comfortably, and a single
   * indexed-scan is cheaper than a count() + sum() fold over Firestore.
   *
   * Hard cap at MAX_BALANCE_ENTRIES to protect Cloud Run from an
   * unbounded scan: a pathological org (or an abusive fixture) could
   * otherwise exhaust the instance's 512 MiB memory. When we hit the
   * cap, callers raise a 503 with a clear error telling the operator
   * that a materialised summary doc is needed — forcing a conversation
   * before we paper over real scaling debt. That materialised
   * `balanceSummaries/{orgId}` doc (maintained by a Pub/Sub listener)
   * is the right move BEFORE we lift this limit, NOT read-time
   * pagination of the fold.
   */
  async findAllByOrganization(organizationId: string): Promise<BalanceTransaction[]> {
    const snap = await this.collection
      .where("organizationId", "==", organizationId)
      .orderBy("createdAt", "asc")
      .limit(MAX_BALANCE_ENTRIES + 1) // +1 so we can detect overflow
      .get();
    if (snap.size > MAX_BALANCE_ENTRIES) {
      throw new BalanceLedgerTooLargeError(organizationId, MAX_BALANCE_ENTRIES);
    }

    // Pre-503 alerting: log structured warnings at 80% and 95% of the
    // cap so operators can schedule the `balanceSummaries` materialised
    // doc BEFORE an organization starts seeing 503s on /finance. Both
    // thresholds use stderr (allowed per CLAUDE.md) so Cloud Logging
    // picks them up and a metric-based alert can page the on-call when
    // any org crosses 95%. Keeps the fold path silent for orgs well
    // below the cap (the vast majority).
    if (snap.size >= Math.floor(MAX_BALANCE_ENTRIES * 0.95)) {
      process.stderr.write(
        `balance-ledger: org=${organizationId} is at ${snap.size}/${MAX_BALANCE_ENTRIES} entries (>=95% cap). Materialised balanceSummaries doc required before next 5000 entries.\n`,
      );
    } else if (snap.size >= Math.floor(MAX_BALANCE_ENTRIES * 0.8)) {
      process.stderr.write(
        `balance-ledger: org=${organizationId} is at ${snap.size}/${MAX_BALANCE_ENTRIES} entries (>=80% cap). Plan materialised balanceSummaries work.\n`,
      );
    }

    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BalanceTransaction);
  }

  /**
   * Used by the payment backfill script to skip entries that have already
   * been rewritten. Idempotency key is (paymentId, kind) — never more than
   * one `payment` entry + one `platform_fee` entry per payment.
   */
  async findByPaymentIdAndKind(
    paymentId: string,
    kind: BalanceTransaction["kind"],
  ): Promise<BalanceTransaction | null> {
    const snap = await this.collection
      .where("paymentId", "==", paymentId)
      .where("kind", "==", kind)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as BalanceTransaction;
  }
}

export const balanceTransactionRepository = new BalanceTransactionRepository();
