import { type BalanceTransaction, type BalanceTransactionQuery } from "@teranga/shared-types";
import { BaseRepository, type PaginatedResult } from "./base.repository";
import { COLLECTIONS } from "@/config/firebase";

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
   * When this outgrows memory, the right move is a per-org aggregated
   * `balanceSummaries/{orgId}` doc maintained by a Pub/Sub listener — NOT
   * read-time pagination. Until then: keep it simple.
   */
  async findAllByOrganization(organizationId: string): Promise<BalanceTransaction[]> {
    const snap = await this.collection
      .where("organizationId", "==", organizationId)
      .orderBy("createdAt", "asc")
      .get();
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
