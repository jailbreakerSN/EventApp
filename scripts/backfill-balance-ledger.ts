/**
 * Backfill `balanceTransactions` entries from existing `payments` + `payouts`.
 *
 * PR 1 of the finance-ledger migration. Once new payments go through the
 * extended payment.service (which now writes ledger entries alongside the
 * payment doc), historical payments need their ledger entries rewritten so
 * the /finance page aggregates match the lifetime totals.
 *
 * Behavior:
 *   1. For every `payments/*` where status = succeeded, ensure a `payment`
 *      entry and a `platform_fee` entry exist in the ledger. Idempotency
 *      key is (paymentId, kind).
 *   2. For every `payments/*` where refundedAmount > 0, ensure a `refund`
 *      entry exists. Idempotent on (paymentId, kind=refund).
 *   3. For every `payouts/*` — ensure a `payout` entry exists and the
 *      source `payment`/`platform_fee` entries linked to its paymentIds
 *      are flipped to `status=paid_out`, `payoutId` set. Idempotent —
 *      safe to re-run.
 *
 * Usage:
 *   # Against emulators (default)
 *   npx tsx scripts/backfill-balance-ledger.ts
 *
 *   # Against staging — requires ADC / GOOGLE_APPLICATION_CREDENTIALS
 *   SEED_TARGET=staging FIREBASE_PROJECT_ID=teranga-events-staging \
 *     npx tsx scripts/backfill-balance-ledger.ts
 *
 * NO destructive writes: the script only UPSERTS missing entries. It does
 * not delete or overwrite any existing ledger rows. Safe to run during
 * normal traffic (writes are per-payment and individually atomic).
 *
 * CONCURRENCY: deterministic document IDs derived from (paymentId|payoutId,
 * kind) make every write naturally idempotent — two concurrent runs of
 * the script write to the SAME docId, so the second call overwrites the
 * first with identical data. No transaction wrapper needed, no duplicate
 * entries. This is safer than a check-then-set with random IDs.
 */

import { createHash } from "node:crypto";

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Payment, Payout, BalanceTransaction } from "@teranga/shared-types";

const SEED_TARGET = process.env.SEED_TARGET ?? "emulator";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "teranga-app-990a8";

if (SEED_TARGET === "emulator" && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
}

// Keep in sync with apps/api/src/config/finance.ts. Duplicated here because
// this script runs outside the API bundle and we don't want a cross-package
// import from a one-off script.
const PLATFORM_FEE_RATE = Number(process.env.PLATFORM_FEE_RATE ?? "0.05");
const FUNDS_RELEASE_DAYS = Number(process.env.FUNDS_RELEASE_DAYS ?? "7");

function computePlatformFee(grossXof: number): number {
  return Math.round(grossXof * PLATFORM_FEE_RATE);
}

function computeAvailableOn(
  paymentCompletedAt: string,
  eventEndDate: string | null | undefined,
): string {
  const anchor = eventEndDate ?? paymentCompletedAt;
  return new Date(new Date(anchor).getTime() + FUNDS_RELEASE_DAYS * 86_400_000).toISOString();
}

/**
 * Deterministic document ID for an idempotent backfill write. Same input
 * always produces the same ID — concurrent runs converge on the same doc
 * rather than racing to create duplicates. Uses SHA-256 truncated to 20
 * chars (ample collision resistance for < 2^40 entries per namespace).
 */
function backfillDocId(kind: string, sourceId: string): string {
  const hash = createHash("sha256").update(`${kind}|${sourceId}`).digest("hex");
  return `backfill_${hash.slice(0, 20)}`;
}

async function exists(db: Firestore, docId: string): Promise<boolean> {
  const snap = await db.collection("balanceTransactions").doc(docId).get();
  return snap.exists;
}

async function main(): Promise<void> {
  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }
  const db = getFirestore();

  console.log(`[backfill-ledger] Target=${SEED_TARGET} Project=${PROJECT_ID}`);

  let paymentsWritten = 0;
  let feesWritten = 0;
  let refundsWritten = 0;
  let payoutsWritten = 0;
  let sweptEntries = 0;

  // ── Cache of event endDates so we can compute availableOn correctly
  //    without N round-trips.
  const eventEndDates = new Map<string, string | null>();
  async function getEventEndDate(eventId: string): Promise<string | null> {
    if (eventEndDates.has(eventId)) return eventEndDates.get(eventId)!;
    const snap = await db.collection("events").doc(eventId).get();
    const data = snap.data() as { endDate?: string; startDate?: string } | undefined;
    const endDate = data?.endDate ?? data?.startDate ?? null;
    eventEndDates.set(eventId, endDate);
    return endDate;
  }

  // ── Payments pass ────────────────────────────────────────────────────────
  const paymentsSnap = await db.collection("payments").get();
  console.log(`[backfill-ledger] Scanning ${paymentsSnap.size} payment(s)…`);

  for (const doc of paymentsSnap.docs) {
    const payment = { id: doc.id, ...doc.data() } as Payment;

    if (payment.status !== "succeeded" && payment.status !== "refunded") {
      // Only confirmed / refunded payments affected the balance. Pending /
      // processing / failed contributed nothing and need no backfill.
      continue;
    }

    const eventEndDate = await getEventEndDate(payment.eventId);
    const completedAt = payment.completedAt ?? payment.createdAt;
    const availableOn = computeAvailableOn(completedAt, eventEndDate);

    // Decide target status based on whether the event has already ended.
    // This is the best we can do at backfill time: new entries go directly
    // to `available` if availableOn is already in the past, otherwise
    // `pending`. Live event traffic uses the same rule.
    const now = Date.now();
    const targetStatus: BalanceTransaction["status"] =
      new Date(availableOn).getTime() <= now ? "available" : "pending";

    // ── payment entry (deterministic docId for idempotent upsert)
    const paymentDocId = backfillDocId("payment", payment.id);
    if (!(await exists(db, paymentDocId))) {
      const entry: BalanceTransaction = {
        id: paymentDocId,
        organizationId: payment.organizationId,
        eventId: payment.eventId,
        paymentId: payment.id,
        payoutId: null,
        kind: "payment",
        amount: payment.amount,
        currency: "XOF",
        status: targetStatus,
        availableOn,
        description: `Billet (backfill)`,
        createdBy: "system:backfill",
        createdAt: completedAt,
      };
      await db.collection("balanceTransactions").doc(paymentDocId).set(entry);
      paymentsWritten++;
    }

    // ── platform_fee entry
    const feeAmount = computePlatformFee(payment.amount);
    if (feeAmount > 0) {
      const feeDocId = backfillDocId("platform_fee", payment.id);
      if (!(await exists(db, feeDocId))) {
        const entry: BalanceTransaction = {
          id: feeDocId,
          organizationId: payment.organizationId,
          eventId: payment.eventId,
          paymentId: payment.id,
          payoutId: null,
          kind: "platform_fee",
          amount: -feeAmount,
          currency: "XOF",
          status: targetStatus,
          availableOn,
          description: `Frais plateforme (backfill, ${Math.round(
            (feeAmount / payment.amount) * 100,
          )}%)`,
          createdBy: "system:backfill",
          createdAt: completedAt,
        };
        await db.collection("balanceTransactions").doc(feeDocId).set(entry);
        feesWritten++;
      }
    }

    // ── refund entry (only if a refund was actually recorded)
    if (payment.refundedAmount && payment.refundedAmount > 0) {
      const refundDocId = backfillDocId("refund", payment.id);
      if (!(await exists(db, refundDocId))) {
        const refundAt = payment.updatedAt ?? completedAt;
        const entry: BalanceTransaction = {
          id: refundDocId,
          organizationId: payment.organizationId,
          eventId: payment.eventId,
          paymentId: payment.id,
          payoutId: null,
          kind: "refund",
          amount: -payment.refundedAmount,
          currency: "XOF",
          status: "available", // refunds never sit in pending
          availableOn: refundAt,
          description: `Remboursement (backfill)`,
          createdBy: "system:backfill",
          createdAt: refundAt,
        };
        await db.collection("balanceTransactions").doc(refundDocId).set(entry);
        refundsWritten++;
      }
    }
  }

  // ── Payouts pass ─────────────────────────────────────────────────────────
  const payoutsSnap = await db.collection("payouts").get();
  console.log(`[backfill-ledger] Scanning ${payoutsSnap.size} payout(s)…`);

  for (const doc of payoutsSnap.docs) {
    const payout = { id: doc.id, ...doc.data() } as Payout;

    // ── payout debit entry (deterministic docId for idempotent upsert)
    const payoutDocId = backfillDocId("payout", payout.id);
    if (!(await exists(db, payoutDocId))) {
      const entry: BalanceTransaction = {
        id: payoutDocId,
        organizationId: payout.organizationId,
        eventId: payout.eventId,
        paymentId: null,
        payoutId: payout.id,
        kind: "payout",
        amount: -payout.netAmount,
        currency: "XOF",
        status: "paid_out",
        availableOn: payout.completedAt ?? payout.createdAt,
        description: `Versement (backfill)`,
        createdBy: "system:backfill",
        createdAt: payout.createdAt,
      };
      await db.collection("balanceTransactions").doc(payoutDocId).set(entry);
      payoutsWritten++;
    }

    // ── Sweep source entries linked to paymentIds in this payout
    for (let i = 0; i < payout.paymentIds.length; i += 10) {
      const chunk = payout.paymentIds.slice(i, i + 10);
      const snap = await db
        .collection("balanceTransactions")
        .where("organizationId", "==", payout.organizationId)
        .where("paymentId", "in", chunk)
        .get();
      for (const d of snap.docs) {
        const entry = d.data() as BalanceTransaction;
        // Skip the `refund` kind — refunds are not swept into a payout
        // (they reduce the balance independently). Only payment +
        // platform_fee entries get flipped.
        if (entry.kind !== "payment" && entry.kind !== "platform_fee") continue;
        if (entry.status === "paid_out" && entry.payoutId === payout.id) continue;
        await d.ref.update({ status: "paid_out", payoutId: payout.id });
        sweptEntries++;
      }
    }
  }

  console.log(
    `[backfill-ledger] Done. payments=${paymentsWritten} fees=${feesWritten} refunds=${refundsWritten} payouts=${payoutsWritten} swept=${sweptEntries}`,
  );
}

main().catch((err) => {
  console.error("[backfill-ledger] FAILED", err);
  process.exit(1);
});
