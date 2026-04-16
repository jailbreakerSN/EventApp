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
      // ── Read phase: fetch every ledger entry that will be swept by this
      //    payout. Firestore transactions require all reads before any writes.
      //    We use `in` filter chunks of 10 (Firestore's limit) to find all
      //    `payment` + `platform_fee` entries linked to the payments being
      //    included.
      const linkedEntryRefs: FirebaseFirestore.DocumentReference[] = [];
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
          linkedEntryRefs.push(d.ref);
        }
      }

      // ── Write phase ────────────────────────────────────────────────────
      tx.set(payoutRef, payout);

      // Debit entry: records the fact that `netAmount` left the org's
      // available balance to be transferred to the bank.
      appendLedgerEntry(tx, {
        organizationId: event.organizationId,
        eventId,
        paymentId: null,
        payoutId: payoutRef.id,
        kind: "payout",
        amount: -netAmount,
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
