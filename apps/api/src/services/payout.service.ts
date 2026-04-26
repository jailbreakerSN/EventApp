import { type Payout, type BalanceTransaction } from "@teranga/shared-types";
import { payoutRepository } from "@/repositories/payout.repository";
import { paymentRepository } from "@/repositories/payment.repository";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ValidationError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { db, COLLECTIONS } from "@/config/firebase";
import { PLATFORM_FEE_RATE, computePlatformFee } from "@/config/finance";
import { appendLedgerEntry } from "./balance-ledger";
import { ConflictError } from "@/errors/app-error";

/**
 * Build the deterministic payout-lock key for an (org, event, period)
 * tuple. The lock is checked + created inside `createPayout()`'s
 * Firestore transaction so two concurrent sweeps on the same period
 * can never both succeed (the second's `tx.create()` throws
 * ALREADY_EXISTS, rolling back its transaction).
 *
 * Periods are ISO 8601 strings; we hash to a stable id rather than
 * embedding them directly to avoid Firestore doc-id length limits and
 * to keep the id URL-safe for lookups in the super-admin console.
 *
 * The `_v1` suffix lets us re-namespace the locks if a future Phase
 * tightens the period definition (e.g. switches to UTC-bucketed
 * windows) without orphaning the existing locks.
 */
function payoutLockKey(
  organizationId: string,
  eventId: string,
  periodFrom: string,
  periodTo: string,
): string {
  // Sanitize: replace any non-doc-id-safe char so the deterministic
  // string lands cleanly. Firestore allows alphanumerics + a few
  // separators; ISO 8601 already contains `:` and `.` which are not
  // doc-id-legal. We replace them with `_` rather than hashing so the
  // lock key stays human-readable in the super-admin dashboard.
  const safe = (s: string) => s.replace(/[^A-Za-z0-9-]/g, "_");
  return `${organizationId}__${eventId}__${safe(periodFrom)}__${safe(periodTo)}__v1`;
}

export class PayoutService extends BaseService {
  /**
   * Preview payout calculation for an event and period.
   */
  async calculatePayout(
    eventId: string,
    periodFrom: string,
    periodTo: string,
    user: AuthUser,
  ): Promise<{
    totalAmount: number;
    platformFee: number;
    netAmount: number;
    paymentCount: number;
  }> {
    this.requirePermission(user, "payout:read");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const { data: payments } = await paymentRepository.findByEvent(
      eventId,
      { status: "succeeded" },
      { page: 1, limit: 10000 },
    );

    // Filter by period
    const filtered = payments.filter((p) => {
      const completedAt = p.completedAt ?? p.createdAt;
      return completedAt >= periodFrom && completedAt <= periodTo;
    });

    const totalAmount = filtered.reduce((sum, p) => sum + p.amount - p.refundedAmount, 0);
    const platformFee = computePlatformFee(totalAmount);
    const netAmount = totalAmount - platformFee;

    return {
      totalAmount,
      platformFee,
      netAmount,
      paymentCount: filtered.length,
    };
  }

  /**
   * Create a payout record for an event and period.
   */
  async createPayout(
    eventId: string,
    periodFrom: string,
    periodTo: string,
    user: AuthUser,
  ): Promise<Payout> {
    this.requirePermission(user, "payout:create");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Phase-1 audit follow-up — defensive `paidTickets` plan gate.
    // Payouts only exist when there are paid payments, so a free /
    // starter org should never reach this path in practice. But a
    // pro / enterprise org that downgrades AFTER collecting payments
    // could otherwise still trigger payouts on legacy revenue. Gate
    // here so the policy is explicit and the org sees a clean
    // PlanLimitError instead of progressing through Firestore reads
    // that would silently produce an empty / zero-net payout.
    const org = await organizationRepository.findByIdOrThrow(event.organizationId);
    this.requirePlanFeature(org, "paidTickets");

    // Outer fast-path: short-circuit early if the period has no
    // succeeded payments at all. The tx-internal re-read is
    // authoritative — this outer query just avoids a needless tx
    // round-trip when there's clearly nothing to pay out.
    const { data: outerPayments } = await paymentRepository.findByEvent(
      eventId,
      { status: "succeeded" },
      { page: 1, limit: 10000 },
    );
    const outerFiltered = outerPayments.filter((p) => {
      const completedAt = p.completedAt ?? p.createdAt;
      return completedAt >= periodFrom && completedAt <= periodTo;
    });
    if (outerFiltered.length === 0) {
      throw new ValidationError("Aucun paiement confirmé dans la période sélectionnée");
    }

    const now = new Date().toISOString();
    const payoutRef = db.collection(COLLECTIONS.PAYOUTS).doc();
    let committedPayout: Payout | null = null;

    // Atomic: create payout doc + debit ledger entry + sweep source entries
    // into `paid_out` status. All reads happen at the top of the tx
    // (Firestore reads-before-writes invariant), all writes follow.
    await db.runTransaction(async (tx) => {
      // ─── READ PHASE ──────────────────────────────────────────────────
      // Reads MUST precede writes per Firestore tx semantics. Order:
      //   1. Lock doc — used as the idempotency sentinel via in-tx
      //      existence check (replaces the prior `tx.create()` which
      //      violated reads-before-writes).
      //   2. Payment list — re-fetched INSIDE the tx so the linked-
      //      entries query uses fresh data. Phase-1 audit follow-up:
      //      previously the chunked balanceTransactions query used
      //      `filtered.map(p => p.id)` from the OUTER read, missing
      //      any payment that became `succeeded` between the outer
      //      query and the tx — those payments' ledger entries were
      //      never swept, leaving orphaned `pending` rows that
      //      inflated every subsequent balance query.
      //   3. Linked balance-transaction entries — chunked by 10 due
      //      to Firestore's `where in` cap. Sum payment + platform_fee
      //      gross/fee, capture refund rows that raced the outer read.

      // 1. Lock existence check. Fresh (in-tx) read of the lock doc.
      const lockRef = db
        .collection(COLLECTIONS.PAYOUT_LOCKS)
        .doc(payoutLockKey(event.organizationId, eventId, periodFrom, periodTo));
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists) {
        // The lock is permanent — one payout per period is the desired
        // semantic. A second legitimate sweep on the same period (e.g.
        // operator typo'd the period and wants to redo it) requires
        // soft-cancelling the existing Payout via the super-admin
        // console, which deletes the lock as part of that flow.
        throw new ConflictError(
          "Un versement existe déjà pour cette période. Pour le rejouer, annulez-le d'abord depuis la console super-admin.",
        );
      }

      // 2. Re-read payments INSIDE the tx — closes the race where a
      //    payment becomes `succeeded` between the outer read and
      //    this tx's serialisation point. Firestore tx-isolation
      //    guarantees this snapshot is consistent with the
      //    balance-transaction reads below and with the lock check
      //    above.
      const paymentsSnap = await tx.get(
        db
          .collection(COLLECTIONS.PAYMENTS)
          .where("eventId", "==", eventId)
          .where("status", "==", "succeeded"),
      );
      const txFiltered = paymentsSnap.docs
        .map((d) => d.data() as { id?: string; completedAt?: string | null; createdAt: string })
        .map((p, idx) => ({ ...p, id: p.id ?? paymentsSnap.docs[idx].id }))
        .filter((p) => {
          const completedAt = p.completedAt ?? p.createdAt;
          return completedAt >= periodFrom && completedAt <= periodTo;
        });
      if (txFiltered.length === 0) {
        // Possible if a refund + status-flip raced and emptied the
        // window between the outer read and the tx. Defensive abort.
        throw new ValidationError(
          "Aucun paiement confirmé dans la période sélectionnée (état rafraîchi en transaction)",
        );
      }

      // 3. Linked balance-transaction entries — chunked by 10 to
      //    respect Firestore's `where in` limit. Sum tx-fresh
      //    payment + platform_fee gross / fee.
      //
      // P1-05 (audit M2) — `txTotalAmount` and `txNetAmount` are
      // re-computed FROM THE LEDGER ENTRIES IN THE TX. The ledger
      // is the source of truth: every refund is its own `refund`-
      // kind row that debits the balance immediately (status=
      // available from inception). By summing swept entries AND
      // capturing already-`available` refund rows for the same
      // paymentIds, we get a netAmount that exactly matches the
      // org's true balance at tx-commit time.
      const linkedEntryRefs: FirebaseFirestore.DocumentReference[] = [];
      let txGross = 0;
      let txFee = 0;
      let txRefundedSinceOuterRead = 0;
      for (let i = 0; i < txFiltered.length; i += 10) {
        const chunk = txFiltered.slice(i, i + 10);
        const snap = await tx.get(
          db
            .collection(COLLECTIONS.BALANCE_TRANSACTIONS)
            .where("organizationId", "==", event.organizationId)
            .where(
              "paymentId",
              "in",
              chunk.map((p) => p.id!),
            ),
        );
        for (const d of snap.docs) {
          const entry = d.data() as BalanceTransaction;
          // Guard: skip entries already swept into another payout
          // (idempotency — should never happen if the lock guarded
          // this period, but defensive).
          if (entry.status === "paid_out" || entry.payoutId) continue;
          if (entry.kind === "payment") {
            txGross += entry.amount;
            linkedEntryRefs.push(d.ref);
          } else if (entry.kind === "platform_fee") {
            txFee += -entry.amount; // platform_fee.amount is negative; convert to positive fee total
            linkedEntryRefs.push(d.ref);
          } else if (entry.kind === "refund") {
            // Refund rows are `available` from inception and stay
            // that way; they're NOT swept into the payout. They DO
            // affect the org's available balance though, so their
            // (negative) contribution must be subtracted from the
            // payout net.
            txRefundedSinceOuterRead += -entry.amount; // amount is negative
          }
        }
      }
      const txTotalAmount = Math.max(0, txGross - txRefundedSinceOuterRead);
      const txPlatformFee = txFee;
      const txNetAmount = Math.max(0, txTotalAmount - txPlatformFee);

      // Defensive: if the in-tx recompute produced a non-positive
      // netAmount (e.g. all swept entries were already refunded),
      // abort the payout cleanly rather than write a zero-or-
      // negative payout.
      if (txNetAmount <= 0) {
        throw new ValidationError(
          "Aucun montant net à verser après prise en compte des remboursements en cours",
        );
      }

      // ─── WRITE PHASE ────────────────────────────────────────────────
      // All reads complete; now safe to write.

      const payout: Payout = {
        id: payoutRef.id,
        organizationId: event.organizationId,
        eventId,
        totalAmount: txTotalAmount,
        platformFee: txPlatformFee,
        platformFeeRate: PLATFORM_FEE_RATE,
        netAmount: txNetAmount,
        status: "pending",
        paymentIds: txFiltered.map((p) => p.id!),
        periodFrom,
        periodTo,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      committedPayout = payout;

      // Idempotency sentinel write — if a concurrent caller raced past
      // our `tx.get(lockRef)` check, the Firestore commit serialiser
      // detects the conflict and ABORTS this tx (Admin SDK retries
      // the whole callback). On retry, our `tx.get(lockRef)` sees
      // the now-existing lock and throws ConflictError. Belt-and-
      // braces with `tx.create()`'s ALREADY_EXISTS semantic for the
      // case where the lock doc raced into existence between this
      // tx's read snapshot and commit.
      tx.create(lockRef, {
        organizationId: event.organizationId,
        eventId,
        periodFrom,
        periodTo,
        payoutId: payoutRef.id,
        createdBy: user.uid,
        createdAt: now,
      });

      tx.set(payoutRef, payout);

      // Debit entry: records the fact that `txNetAmount` left the
      // org's available balance to be transferred to the bank.
      appendLedgerEntry(tx, {
        organizationId: event.organizationId,
        eventId,
        paymentId: null,
        payoutId: payoutRef.id,
        kind: "payout",
        amount: -txNetAmount,
        status: "paid_out",
        availableOn: now,
        description: `Versement ${new Date(periodFrom).toLocaleDateString("fr-FR")} — ${new Date(
          periodTo,
        ).toLocaleDateString("fr-FR")}`,
        createdBy: user.uid,
        createdAt: now,
      });

      // Sweep source entries: flip their status to `paid_out` and stamp
      // the payoutId so the balance fold no longer counts them toward
      // available/pending. Balance math: +100 payment + (−5) fee + (−95)
      // payout = 0 (once all three are paid_out).
      for (const ref of linkedEntryRefs) {
        tx.update(ref, { status: "paid_out", payoutId: payoutRef.id });
      }
    });

    // committedPayout is set inside the tx; if the tx threw, we never
    // reach this point. Non-null assertion is safe.
    /* istanbul ignore next */
    if (!committedPayout) {
      throw new Error("Payout commit succeeded but committedPayout was not set — tx invariant broken");
    }
    const finalPayout = committedPayout as Payout;

    // Phase-1 audit follow-up — emit uses the IN-TX `netAmount`,
    // not the outer-read placeholder. The previous shape used a
    // pre-tx `netAmount` variable that ignored the in-tx
    // recomputation; an audit consumer reading `payout.created`
    // payloads would see a different netAmount than the actual
    // committed Payout doc.
    eventBus.emit("payout.created", {
      payoutId: payoutRef.id,
      eventId,
      organizationId: event.organizationId,
      netAmount: finalPayout.netAmount,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return finalPayout;
  }

  /**
   * List payouts for an organization.
   */
  async listPayouts(
    organizationId: string,
    filters: { status?: string },
    pagination: { page: number; limit: number },
    user: AuthUser,
  ) {
    this.requirePermission(user, "payout:read");
    this.requireOrganizationAccess(user, organizationId);
    return payoutRepository.findByOrganization(organizationId, filters, pagination);
  }

  /**
   * Get a payout detail.
   */
  async getPayoutDetail(payoutId: string, user: AuthUser): Promise<Payout> {
    this.requirePermission(user, "payout:read");
    const payout = await payoutRepository.findByIdOrThrow(payoutId);
    this.requireOrganizationAccess(user, payout.organizationId);
    return payout;
  }
}

export const payoutService = new PayoutService();
