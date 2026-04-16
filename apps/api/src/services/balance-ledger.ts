import { type Transaction } from "firebase-admin/firestore";
import {
  type BalanceTransaction,
  type BalanceTransactionKind,
  type BalanceTransactionStatus,
  type OrganizationBalance,
} from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";

// ─── Ledger Helpers ──────────────────────────────────────────────────────────
//
// Pure helpers used by the domain services that own money movements. All of
// these are designed to be called INSIDE an existing Firestore transaction —
// the caller passes `tx` and we append the write to its pending set. No
// transactional wrapper is created here; the payment/payout services already
// own their tx for atomicity with the payment/payout doc itself.
//
// Why an internal builder rather than a thin wrapper around tx.set?
//   - Single place to enforce the amount-sign / kind invariants.
//   - Consistent description strings & createdBy attribution across callers.
//   - Single import surface for the backfill script.

export interface BuildLedgerEntryInput {
  organizationId: string;
  eventId: string | null;
  paymentId: string | null;
  payoutId: string | null;
  kind: BalanceTransactionKind;
  /**
   * Signed amount in XOF. The caller is responsible for sign correctness; we
   * validate at runtime that the sign matches the kind's semantics to catch
   * bugs early.
   */
  amount: number;
  status: BalanceTransactionStatus;
  availableOn: string;
  description: string;
  createdBy: string;
  /** Override createdAt for backfill (where we want to preserve the original
   * payment's timestamp rather than the moment the backfill ran). */
  createdAt?: string;
}

/**
 * Runtime validation of the sign-vs-kind invariant. Catches bugs like passing
 * a positive number with kind=platform_fee. Throws a plain Error (surfaced by
 * the Fastify error handler as 500) because this would only fire on
 * programmer error — never on user input.
 */
function assertAmountSign(kind: BalanceTransactionKind, amount: number): void {
  switch (kind) {
    case "payment":
    case "payout_reversal":
      if (amount <= 0) {
        throw new Error(`Ledger: kind=${kind} requires amount > 0, got ${amount}`);
      }
      return;
    case "platform_fee":
    case "refund":
    case "payout":
      if (amount >= 0) {
        throw new Error(`Ledger: kind=${kind} requires amount < 0, got ${amount}`);
      }
      return;
    case "adjustment":
      // Adjustments can be + or − by design (corrections go both ways).
      if (amount === 0) throw new Error("Ledger: adjustment amount must be non-zero");
      return;
  }
}

/**
 * Append a ledger entry to an open Firestore transaction. Returns the
 * generated document id so the caller can reference it (ex. inside an event
 * payload).
 */
export function appendLedgerEntry(tx: Transaction, input: BuildLedgerEntryInput): string {
  assertAmountSign(input.kind, input.amount);

  const docRef = db.collection(COLLECTIONS.BALANCE_TRANSACTIONS).doc();
  const entry: BalanceTransaction = {
    id: docRef.id,
    organizationId: input.organizationId,
    eventId: input.eventId,
    paymentId: input.paymentId,
    payoutId: input.payoutId,
    kind: input.kind,
    amount: input.amount,
    currency: "XOF",
    status: input.status,
    availableOn: input.availableOn,
    description: input.description,
    createdBy: input.createdBy,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  tx.set(docRef, entry);
  return docRef.id;
}

// ─── Balance Aggregation (pure fold) ─────────────────────────────────────────
//
// Kept as a pure function so it's trivially unit-testable with synthetic
// entries and so the /finance endpoint can swap in an aggregated summary
// doc later without rewriting consumers.

export function computeBalance(
  entries: BalanceTransaction[],
  now: Date = new Date(),
): OrganizationBalance {
  let available = 0;
  let pending = 0;
  let lifetimeRevenue = 0;
  let lifetimeFees = 0;
  let lifetimeRefunded = 0;
  let lifetimePaidOut = 0;
  let payoutCount = 0;
  let lastPayoutAt: string | null = null;

  for (const e of entries) {
    // Available balance is what the org could withdraw right now:
    // status=available AND not yet swept into a payout.
    if (e.status === "available") {
      available += e.amount;
    } else if (e.status === "pending") {
      pending += e.amount;
    }

    switch (e.kind) {
      case "payment":
        lifetimeRevenue += e.amount;
        break;
      case "platform_fee":
        lifetimeFees += Math.abs(e.amount);
        break;
      case "refund":
        lifetimeRefunded += Math.abs(e.amount);
        break;
      case "payout":
        if (e.status === "paid_out") {
          lifetimePaidOut += Math.abs(e.amount);
          payoutCount++;
          if (!lastPayoutAt || e.createdAt > lastPayoutAt) {
            lastPayoutAt = e.createdAt;
          }
        }
        break;
      case "payout_reversal":
      case "adjustment":
        // Do not count toward lifetime revenue/fees; they surface via the
        // transactions table and in `available`/`pending` automatically.
        break;
    }
  }

  return {
    computedAt: now.toISOString(),
    available,
    pending,
    lifetimeRevenue,
    lifetimeFees,
    lifetimeRefunded,
    lifetimePaidOut,
    payoutCount,
    lastPayoutAt,
  };
}
