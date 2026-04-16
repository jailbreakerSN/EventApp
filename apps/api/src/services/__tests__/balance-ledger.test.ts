import { describe, it, expect, vi } from "vitest";
import type { BalanceTransaction } from "@teranga/shared-types";
import { appendLedgerEntry, computeBalance } from "../balance-ledger";

// ─── Mock db so appendLedgerEntry can create doc refs ──────────────────────

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ id: `tx-${Math.random().toString(36).slice(2, 8)}` })),
    })),
  },
  COLLECTIONS: {
    BALANCE_TRANSACTIONS: "balanceTransactions",
  },
}));

// ─── Builders ──────────────────────────────────────────────────────────────

function entry(overrides: Partial<BalanceTransaction>): BalanceTransaction {
  return {
    id: overrides.id ?? "tx-1",
    organizationId: overrides.organizationId ?? "org-1",
    eventId: overrides.eventId ?? "ev-1",
    paymentId: overrides.paymentId ?? null,
    payoutId: overrides.payoutId ?? null,
    kind: "payment",
    amount: 0,
    currency: "XOF",
    status: "pending",
    availableOn: "2026-04-16T00:00:00.000Z",
    description: "",
    createdBy: "system:test",
    createdAt: "2026-04-16T00:00:00.000Z",
    ...overrides,
  } as BalanceTransaction;
}

// ─── appendLedgerEntry — sign invariants ────────────────────────────────────

describe("appendLedgerEntry — sign vs kind invariants", () => {
  const mockTx = { set: vi.fn() };

  it("accepts positive amount for kind=payment", () => {
    expect(() =>
      appendLedgerEntry(mockTx as never, {
        organizationId: "org-1",
        eventId: "ev-1",
        paymentId: "pay-1",
        payoutId: null,
        kind: "payment",
        amount: 1000,
        status: "pending",
        availableOn: "2026-04-16T00:00:00.000Z",
        description: "",
        createdBy: "system:test",
      }),
    ).not.toThrow();
  });

  it("rejects positive amount for kind=platform_fee", () => {
    expect(() =>
      appendLedgerEntry(mockTx as never, {
        organizationId: "org-1",
        eventId: "ev-1",
        paymentId: "pay-1",
        payoutId: null,
        kind: "platform_fee",
        amount: 50, // WRONG SIGN
        status: "pending",
        availableOn: "2026-04-16T00:00:00.000Z",
        description: "",
        createdBy: "system:test",
      }),
    ).toThrow(/platform_fee requires amount < 0/);
  });

  it("rejects negative amount for kind=payment", () => {
    expect(() =>
      appendLedgerEntry(mockTx as never, {
        organizationId: "org-1",
        eventId: "ev-1",
        paymentId: "pay-1",
        payoutId: null,
        kind: "payment",
        amount: -1000, // WRONG SIGN
        status: "pending",
        availableOn: "2026-04-16T00:00:00.000Z",
        description: "",
        createdBy: "system:test",
      }),
    ).toThrow(/payment requires amount > 0/);
  });

  it("rejects zero-amount adjustments", () => {
    expect(() =>
      appendLedgerEntry(mockTx as never, {
        organizationId: "org-1",
        eventId: null,
        paymentId: null,
        payoutId: null,
        kind: "adjustment",
        amount: 0,
        status: "available",
        availableOn: "2026-04-16T00:00:00.000Z",
        description: "",
        createdBy: "admin-uid",
      }),
    ).toThrow(/adjustment amount must be non-zero/);
  });

  it("accepts signed adjustments (corrections go both ways)", () => {
    expect(() =>
      appendLedgerEntry(mockTx as never, {
        organizationId: "org-1",
        eventId: null,
        paymentId: null,
        payoutId: null,
        kind: "adjustment",
        amount: 100,
        status: "available",
        availableOn: "2026-04-16T00:00:00.000Z",
        description: "",
        createdBy: "admin-uid",
      }),
    ).not.toThrow();

    expect(() =>
      appendLedgerEntry(mockTx as never, {
        organizationId: "org-1",
        eventId: null,
        paymentId: null,
        payoutId: null,
        kind: "adjustment",
        amount: -100,
        status: "available",
        availableOn: "2026-04-16T00:00:00.000Z",
        description: "",
        createdBy: "admin-uid",
      }),
    ).not.toThrow();
  });
});

// ─── computeBalance — pure fold ────────────────────────────────────────────

describe("computeBalance — pure fold", () => {
  const NOW = new Date("2026-06-15T12:00:00.000Z");

  it("empty ledger produces all-zero balance", () => {
    const result = computeBalance([], NOW);
    expect(result).toEqual({
      computedAt: NOW.toISOString(),
      available: 0,
      pending: 0,
      lifetimeRevenue: 0,
      lifetimeFees: 0,
      lifetimeRefunded: 0,
      lifetimePaidOut: 0,
      payoutCount: 0,
      lastPayoutAt: null,
    });
  });

  it("pending payment + pending fee contribute to pending only", () => {
    const result = computeBalance(
      [
        entry({ kind: "payment", amount: 10_000, status: "pending" }),
        entry({ kind: "platform_fee", amount: -500, status: "pending" }),
      ],
      NOW,
    );

    expect(result.pending).toBe(9_500); // +10 000 − 500
    expect(result.available).toBe(0);
    expect(result.lifetimeRevenue).toBe(10_000);
    expect(result.lifetimeFees).toBe(500);
  });

  it("available payment + fee contribute to available and to lifetime revenue", () => {
    const result = computeBalance(
      [
        entry({ kind: "payment", amount: 10_000, status: "available" }),
        entry({ kind: "platform_fee", amount: -500, status: "available" }),
      ],
      NOW,
    );

    expect(result.available).toBe(9_500);
    expect(result.pending).toBe(0);
    expect(result.lifetimeRevenue).toBe(10_000);
  });

  it("paid_out payment no longer contributes to available (swept by payout)", () => {
    const result = computeBalance(
      [
        // Full sweep: +10k payment, -500 fee, -9500 payout, all paid_out
        entry({ kind: "payment", amount: 10_000, status: "paid_out" }),
        entry({ kind: "platform_fee", amount: -500, status: "paid_out" }),
        entry({
          kind: "payout",
          amount: -9_500,
          status: "paid_out",
          createdAt: "2026-05-01T00:00:00.000Z",
        }),
      ],
      NOW,
    );

    expect(result.available).toBe(0);
    expect(result.pending).toBe(0);
    expect(result.lifetimeRevenue).toBe(10_000); // lifetime unaffected by status
    expect(result.lifetimeFees).toBe(500);
    expect(result.lifetimePaidOut).toBe(9_500);
    expect(result.payoutCount).toBe(1);
    expect(result.lastPayoutAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("refund debits available balance immediately and counts in lifetimeRefunded", () => {
    const result = computeBalance(
      [
        entry({ kind: "payment", amount: 10_000, status: "available" }),
        entry({ kind: "platform_fee", amount: -500, status: "available" }),
        entry({ kind: "refund", amount: -10_000, status: "available" }),
      ],
      NOW,
    );

    expect(result.available).toBe(-500); // −500 fee still debited; payment refunded
    expect(result.lifetimeRevenue).toBe(10_000);
    expect(result.lifetimeRefunded).toBe(10_000);
  });

  it("lastPayoutAt is the maximum createdAt across paid_out payout entries", () => {
    const result = computeBalance(
      [
        entry({
          kind: "payout",
          amount: -1_000,
          status: "paid_out",
          createdAt: "2026-03-01T00:00:00.000Z",
        }),
        entry({
          kind: "payout",
          amount: -2_000,
          status: "paid_out",
          createdAt: "2026-05-01T00:00:00.000Z",
        }),
        entry({
          kind: "payout",
          amount: -3_000,
          status: "paid_out",
          createdAt: "2026-04-01T00:00:00.000Z",
        }),
      ],
      NOW,
    );

    expect(result.payoutCount).toBe(3);
    expect(result.lastPayoutAt).toBe("2026-05-01T00:00:00.000Z");
    expect(result.lifetimePaidOut).toBe(6_000);
  });

  it("pending payout is NOT yet counted in lifetimePaidOut (waiting for bank confirmation)", () => {
    // Shouldn't happen in current code (payouts are created paid_out in PR 1)
    // but the fold must not double-count if Wave 6 introduces a pending state.
    const result = computeBalance(
      [entry({ kind: "payout", amount: -9_500, status: "pending" })],
      NOW,
    );

    expect(result.lifetimePaidOut).toBe(0);
    expect(result.payoutCount).toBe(0);
  });

  it("adjustment entries surface in available/pending but not in lifetime totals", () => {
    const result = computeBalance(
      [
        entry({ kind: "adjustment", amount: 500, status: "available" }),
        entry({ kind: "adjustment", amount: -200, status: "available" }),
      ],
      NOW,
    );

    expect(result.available).toBe(300);
    expect(result.lifetimeRevenue).toBe(0);
    expect(result.lifetimeFees).toBe(0);
    expect(result.lifetimeRefunded).toBe(0);
  });
});
