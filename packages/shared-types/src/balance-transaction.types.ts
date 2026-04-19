import { z } from "zod";

// ─── Balance Transaction (Ledger) ────────────────────────────────────────────
//
// The `balance_transactions` collection is the single source of truth for an
// organization's money state. Modelled after Stripe's balance_transactions /
// Adyen's transfer_transactions / Chargebee's revenue ledger — every money
// movement (payment in, fee out, refund out, payout out) produces exactly one
// entry, signed by the direction (+ for credit to org, − for debit).
//
// Why a ledger instead of summing `payments` at read time:
//   - Clear semantic for the /finance page: balance view, not a collection
//     dump. Matches operator mental model ("how much do I have right now?").
//   - Disputes, chargebacks, manual adjustments, and T+N release windows are
//     all representable without schema changes — just new `kind` values.
//   - Audit trail is the ledger itself. Immutable by policy (no UPDATE path).
//   - Scales linearly on `organizationId` — no fan-out joins required.
//
// Write rule: every entry is produced INSIDE an existing Firestore transaction
// of the domain service that owns the money movement. Never written outside a
// transaction, never written from the client.
//
// Immutability: entries are append-only. The only supported mutation is the
// `status` / `payoutId` flip when an entry is swept into a payout batch —
// and even that happens inside the payout-creation transaction.

// ─── Kind ──────────────────────────────────────────────────────────────────

export const BalanceTransactionKindSchema = z.enum([
  "payment", // +amount — customer paid a ticket (net of fees)
  "platform_fee", // −fee    — Teranga's cut on the payment
  "refund", // −amount — refund issued to customer
  "payout", // −amount — bank transfer initiated (reserves funds)
  "payout_reversal", // +amount — payout failed / cancelled, funds returned
  "adjustment", // ±amount — manual correction (super_admin only)
]);

export type BalanceTransactionKind = z.infer<typeof BalanceTransactionKindSchema>;

// ─── Status ────────────────────────────────────────────────────────────────
//
//   pending   → funds are captured but not yet released (ex. awaiting event
//               completion + T+N settlement window). Counts toward
//               lifetimeRevenue but NOT toward available balance.
//   available → funds are released and withdrawable. Counts toward the
//               available balance until swept into a payout.
//   paid_out  → entry has been included in a payouts/{id} batch and is no
//               longer part of the available balance.
//
// Refunds skip "pending" (status=available) — they debit the balance
// immediately, regardless of whether the original payment's release window
// has elapsed. This matches Stripe's behaviour.

export const BalanceTransactionStatusSchema = z.enum(["pending", "available", "paid_out"]);

export type BalanceTransactionStatus = z.infer<typeof BalanceTransactionStatusSchema>;

// ─── Document ──────────────────────────────────────────────────────────────

export const BalanceTransactionSchema = z.object({
  id: z.string(),
  organizationId: z.string(), // primary query axis
  eventId: z.string().nullable(), // nullable for org-level entries (adjustments)
  paymentId: z.string().nullable(), // FK when kind in { payment, platform_fee, refund }
  payoutId: z.string().nullable(), // FK when kind in { payout, payout_reversal }, or when a
  // source entry has been swept into a payout batch
  kind: BalanceTransactionKindSchema,
  // Signed integer in XOF. Positive = credit the org's balance,
  // negative = debit. The sign MUST match the kind's semantics; enforced in
  // the service layer (no schema cross-field refinement to stay ergonomic).
  amount: z.number().int(),
  currency: z.literal("XOF"),
  status: BalanceTransactionStatusSchema,
  // ISO date when a `pending` entry is scheduled to become `available`.
  // For entries that are `available` from inception (refunds, adjustments),
  // equals the creation timestamp.
  availableOn: z.string().datetime(),
  description: z.string().max(500),
  // Creator identity: actor uid, or `"system:<event>"` for automated writes
  // (ex. `system:payment.webhook`, `system:payout.scheduler`).
  createdBy: z.string(),
  createdAt: z.string().datetime(),
});

export type BalanceTransaction = z.infer<typeof BalanceTransactionSchema>;

// ─── Query ─────────────────────────────────────────────────────────────────

export const BalanceTransactionQuerySchema = z.object({
  kind: BalanceTransactionKindSchema.optional(),
  status: BalanceTransactionStatusSchema.optional(),
  eventId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type BalanceTransactionQuery = z.infer<typeof BalanceTransactionQuerySchema>;

// ─── Organization Balance Summary ──────────────────────────────────────────
//
// Aggregated view for the /finance page. Computed on-demand from the ledger
// (single-axis query + in-memory fold). No snapshotting, no caching —
// Firestore handles the read load on the `organizationId` index, and the
// operator always sees fresh numbers.
//
// Shape mirrors Stripe's GET /v1/balance + Adyen's /balanceAccounts/{id}.

export interface OrganizationBalance {
  /** ISO timestamp this summary was computed at. */
  computedAt: string;
  /** Funds released and withdrawable (Σ kind != payout AND status = available). */
  available: number;
  /** Captured but not yet released (Σ status = pending). */
  pending: number;
  /** Lifetime: Σ kind = payment (regardless of status). */
  lifetimeRevenue: number;
  /** Lifetime: |Σ kind = platform_fee|. Always a positive display value. */
  lifetimeFees: number;
  /** Lifetime: |Σ kind = refund|. Always a positive display value. */
  lifetimeRefunded: number;
  /** Lifetime: |Σ kind = payout AND status = paid_out|. Already-paid-out net. */
  lifetimePaidOut: number;
  /** Number of payouts completed lifetime. */
  payoutCount: number;
  /** ISO timestamp of the most recent `payout` entry, or null if none. */
  lastPayoutAt: string | null;
}
