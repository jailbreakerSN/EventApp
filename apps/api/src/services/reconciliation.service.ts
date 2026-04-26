/**
 * Organizer overhaul — Phase O9.
 *
 * Financial reconciliation read model. Aggregates the per-event
 * payment ledger into a `(method, status)` matrix the organizer can
 * eyeball before clicking "Demander le virement".
 *
 *   - One row per `(method, status)` group — wave / orange_money /
 *     mock × succeeded / refunded / failed.
 *   - Totals identical to what `payout.service.calculatePayout()` would
 *     produce — single source of truth, both surfaces share
 *     `computeReconciliation()`.
 *   - Read-only — no Firestore writes here. The actual payout creation
 *     stays in `payout.service.createPayout()`; this service is a
 *     reporting wrapper.
 *
 * Permission: `payout:read` — same gate as the rest of the financial
 * surface. Cross-org access blocked via `requireOrganizationAccess`.
 */

import { BaseService } from "./base.service";
import { eventRepository } from "@/repositories/event.repository";
import { paymentRepository } from "@/repositories/payment.repository";
import { computePlatformFee } from "@/config/finance";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type {
  Payment,
  ReconciliationRow,
  ReconciliationSummary,
  FinancialSummary,
} from "@teranga/shared-types";

class ReconciliationService extends BaseService {
  async getSummary(eventId: string, user: AuthUser): Promise<ReconciliationSummary> {
    this.requirePermission(user, "payout:read");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Cap at 10000 — same upper bound payout.service uses, large enough
    // to cover any plan tier without unbounded reads.
    const { data: payments } = await paymentRepository.findByEvent(
      eventId,
      {},
      { page: 1, limit: 10000 },
    );

    const { rows, totals, lastPaymentAt } = computeReconciliation(payments);

    return {
      eventId,
      organizationId: event.organizationId,
      rows,
      totals,
      lastPaymentAt,
      computedAt: new Date().toISOString(),
    };
  }
}

// ─── Pure helpers (exported for tests) ────────────────────────────────────

export function computeReconciliation(payments: ReadonlyArray<Payment>): {
  rows: ReconciliationRow[];
  totals: FinancialSummary;
  lastPaymentAt: string | null;
} {
  // Group by `(method, status)` so the organizer sees the split between
  // payment provider × outcome. A `Map` keyed by composite string keeps
  // grouping O(n) without a nested loop.
  const buckets = new Map<string, ReconciliationRow>();
  let lastTs: string | null = null;

  for (const p of payments) {
    const key = `${p.method}|${p.status}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalAmount += p.amount;
      existing.refundedAmount += p.refundedAmount;
      existing.netAmount += p.amount - p.refundedAmount;
    } else {
      buckets.set(key, {
        method: p.method,
        status: p.status,
        count: 1,
        totalAmount: p.amount,
        refundedAmount: p.refundedAmount,
        netAmount: p.amount - p.refundedAmount,
      });
    }
    const ts = p.completedAt ?? p.createdAt;
    if (!lastTs || ts > lastTs) lastTs = ts;
  }

  // Stable order — method ASC then status ASC. Avoids the table
  // re-shuffling between renders when one bucket grows.
  const rows = Array.from(buckets.values()).sort((a, b) => {
    if (a.method === b.method) return a.status.localeCompare(b.status);
    return a.method.localeCompare(b.method);
  });

  // Only `succeeded` payments roll into the financial totals — failed
  // payments aren't real revenue, refunds are subtracted via
  // `refundedAmount`.
  const succeeded = payments.filter((p) => p.status === "succeeded");
  const grossAmount = succeeded.reduce((acc, p) => acc + p.amount, 0);
  const refundedAmount = succeeded.reduce((acc, p) => acc + p.refundedAmount, 0);
  const netRevenue = Math.max(0, grossAmount - refundedAmount);
  const platformFee = computePlatformFee(netRevenue);
  const payoutAmount = Math.max(0, netRevenue - platformFee);

  // Distinct registrationIds so the count reflects actual paid seats,
  // not retries.
  const paidRegIds = new Set(succeeded.map((p) => p.registrationId));

  const totals: FinancialSummary = {
    grossAmount,
    refundedAmount,
    netRevenue,
    platformFee,
    payoutAmount,
    paidRegistrations: paidRegIds.size,
    currency: "XOF",
  };

  return { rows, totals, lastPaymentAt: lastTs };
}

export const reconciliationService = new ReconciliationService();
