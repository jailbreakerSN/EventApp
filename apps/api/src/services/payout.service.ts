import { type Payout, type BalanceTransaction } from "@teranga/shared-types";
import { payoutRepository } from "@/repositories/payout.repository";
import { paymentRepository } from "@/repositories/payment.repository";
import { eventRepository } from "@/repositories/event.repository";
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

    const { data: payments } = await paymentRepository.findByEvent(
      eventId,
      { status: "succeeded" },
      { page: 1, limit: 10000 },
    );

    const filtered = payments.filter((p) => {
      const completedAt = p.completedAt ?? p.createdAt;
      return completedAt >= periodFrom && completedAt <= periodTo;
    });

    if (filtered.length === 0) {
      throw new ValidationError("Aucun paiement confirmé dans la période sélectionnée");
    }

    const totalAmount = filtered.reduce((sum, p) => sum + p.amount - p.refundedAmount, 0);
    const platformFee = computePlatformFee(totalAmount);
    const netAmount = totalAmount - platformFee;
    const now = new Date().toISOString();

    // Atomic: create payout doc + debit ledger entry + sweep source entries
    // into `paid_out` status. All inside one tx so the balance can never
    // show a payout without the corresponding debit entry.
    const payoutRef = db.collection(COLLECTIONS.PAYOUTS).doc();
    const payout: Payout = {
      id: payoutRef.id,
      organizationId: event.organizationId,
      eventId,
      totalAmount,
      platformFee,
      platformFeeRate: PLATFORM_FEE_RATE,
      netAmount,
      status: "pending",
      paymentIds: filtered.map((p) => p.id),
      periodFrom,
      periodTo,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.runTransaction(async (tx) => {
      // ── Idempotency sentinel (P1-01 / audit C2) ──────────────────────
      // The lock key is deterministic for (orgId, eventId, periodFrom,
      // periodTo). `tx.create()` throws ALREADY_EXISTS when the doc
      // exists, which rolls the transaction back BEFORE any Payout doc
      // or debit ledger entry is written. This eliminates the
      // double-pay race where two concurrent createPayout() calls on
      // the same period both saw `available` ledger rows in their
      // outer non-tx read and would otherwise both write a Payout
      // (with one of them sweeping zero source entries on retry).
      //
      // The lock is permanent — one payout per period is the desired
      // semantic. A second legitimate sweep on the same period (e.g.
      // operator typo'd the period and wants to redo it) requires
      // soft-cancelling the existing Payout via the super-admin
      // console, which deletes the lock as part of that flow.
      const lockRef = db
        .collection(COLLECTIONS.PAYOUT_LOCKS)
        .doc(payoutLockKey(event.organizationId, eventId, periodFrom, periodTo));
      try {
        await tx.create(lockRef, {
          organizationId: event.organizationId,
          eventId,
          periodFrom,
          periodTo,
          payoutId: payoutRef.id,
          createdBy: user.uid,
          createdAt: now,
        });
      } catch (err) {
        // Firestore code 6 = ALREADY_EXISTS; @google-cloud/firestore
        // surfaces it as `err.code === 6` and the message "Document
        // already exists". We translate into a domain ConflictError
        // so the route returns 409 with a clean message.
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code: unknown }).code
            : undefined;
        if (code === 6) {
          throw new ConflictError(
            "Un versement existe déjà pour cette période. Pour le rejouer, annulez-le d'abord depuis la console super-admin.",
          );
        }
        throw err;
      }

      // ── Read phase: fetch every ledger entry that will be swept by this
      //    payout. Firestore transactions require all reads before any writes.
      //    We use `in` filter chunks of 10 (Firestore's limit) to find all
      //    `payment` + `platform_fee` entries linked to the payments being
      //    included.
      //
      // P1-05 (audit M2) — `txTotalAmount` and `txNetAmount` are
      // re-computed FROM THE LEDGER ENTRIES IN THE TX, not from the
      // outer `filtered` read. The previous behaviour computed
      // `totalAmount = sum(payment.amount - payment.refundedAmount)`
      // from the outer non-tx read, which became stale if a refund
      // raced between the outer read and the tx commit — leading to
      // an over-pay because the refund had already debited the org
      // balance but the netAmount didn't reflect that.
      //
      // The ledger is the source of truth: every refund is its own
      // `refund`-kind row that debits the balance immediately
      // (status=available from inception). By summing the swept
      // entries (payment + platform_fee) AND scanning for
      // already-`available` refund rows for the same paymentIds, we
      // get a netAmount that exactly matches the org's true balance
      // at tx-commit time, regardless of refund-race ordering.
      const linkedEntryRefs: FirebaseFirestore.DocumentReference[] = [];
      let txGross = 0;
      let txFee = 0;
      let txRefundedSinceOuterRead = 0;
      for (let i = 0; i < filtered.length; i += 10) {
        const chunk = filtered.slice(i, i + 10);
        const snap = await tx.get(
          db
            .collection(COLLECTIONS.BALANCE_TRANSACTIONS)
            .where("organizationId", "==", event.organizationId)
            .where(
              "paymentId",
              "in",
              chunk.map((p) => p.id),
            ),
        );
        for (const d of snap.docs) {
          const entry = d.data() as BalanceTransaction;
          // Guard: skip entries already swept into another payout
          // (idempotency — should never happen if `filtered` was derived
          //  correctly, but defensive).
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
      const txPlatformFee = txFee; // already pre-computed by the tx-read of platform_fee rows
      const txNetAmount = Math.max(0, txTotalAmount - txPlatformFee);

      // Update the payout object with tx-fresh totals BEFORE writing.
      // If a refund raced the outer read, this corrects the netAmount
      // to match the org's actual current available balance.
      payout.totalAmount = txTotalAmount;
      payout.platformFee = txPlatformFee;
      payout.netAmount = txNetAmount;

      // Defensive: if the in-tx recompute produced a non-positive
      // netAmount (e.g. all swept entries were already refunded), abort
      // the payout cleanly rather than write a zero-or-negative payout.
      if (txNetAmount <= 0) {
        throw new ValidationError(
          "Aucun montant net à verser après prise en compte des remboursements en cours",
        );
      }

      // ── Write phase ────────────────────────────────────────────────────
      tx.set(payoutRef, payout);

      // Debit entry: records the fact that `txNetAmount` left the
      // org's available balance to be transferred to the bank. We use
      // the tx-recomputed value (P1-05) — not the outer `netAmount`
      // — so a refund that raced the outer read is correctly netted
      // out of the payout amount.
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

    eventBus.emit("payout.created", {
      payoutId: payoutRef.id,
      eventId,
      organizationId: event.organizationId,
      netAmount,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return payout;
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
