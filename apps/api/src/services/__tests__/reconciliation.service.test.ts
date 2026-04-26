import { describe, it, expect } from "vitest";
import { computeReconciliation } from "../reconciliation.service";
import type { Payment } from "@teranga/shared-types";

// ─── Reconciliation pure-helper contract ──────────────────────────────────
//
// `computeReconciliation()` is pure and shared with the payout
// service for the totals. We pin the math here so a refactor that
// changes how rows are grouped or how totals are computed surfaces
// loud test failures.

function makePayment(over: Partial<Payment>): Payment {
  return {
    id: "pay-1",
    registrationId: "reg-1",
    eventId: "evt-1",
    organizationId: "org-1",
    userId: "u-1",
    amount: 10_000,
    currency: "XOF",
    method: "wave",
    providerTransactionId: null,
    status: "succeeded",
    redirectUrl: null,
    callbackUrl: null,
    returnUrl: null,
    providerMetadata: null,
    failureReason: null,
    refundedAmount: 0,
    initiatedAt: "2026-04-01T10:00:00.000Z",
    completedAt: "2026-04-01T10:01:00.000Z",
    createdAt: "2026-04-01T10:00:00.000Z",
    updatedAt: "2026-04-01T10:01:00.000Z",
    ...over,
  };
}

describe("computeReconciliation — grouping by (method, status)", () => {
  it("returns empty rows + zero totals on an empty input", () => {
    const out = computeReconciliation([]);
    expect(out.rows).toEqual([]);
    expect(out.totals).toEqual({
      grossAmount: 0,
      refundedAmount: 0,
      netRevenue: 0,
      platformFee: 0,
      payoutAmount: 0,
      paidRegistrations: 0,
      currency: "XOF",
    });
    expect(out.lastPaymentAt).toBeNull();
  });

  it("groups payments by (method, status) and sums their amounts", () => {
    const payments: Payment[] = [
      makePayment({ id: "p1", method: "wave", amount: 10_000 }),
      makePayment({ id: "p2", method: "wave", amount: 5_000, registrationId: "reg-2" }),
      makePayment({
        id: "p3",
        method: "orange_money",
        amount: 12_000,
        registrationId: "reg-3",
      }),
    ];
    const out = computeReconciliation(payments);
    const wave = out.rows.find((r) => r.method === "wave")!;
    const om = out.rows.find((r) => r.method === "orange_money")!;
    expect(wave.count).toBe(2);
    expect(wave.totalAmount).toBe(15_000);
    expect(om.count).toBe(1);
    expect(om.totalAmount).toBe(12_000);
  });

  it("subtracts refundedAmount from netAmount + total refunds in totals", () => {
    const payments: Payment[] = [makePayment({ id: "p1", amount: 10_000, refundedAmount: 4_000 })];
    const out = computeReconciliation(payments);
    expect(out.rows[0].netAmount).toBe(6_000);
    expect(out.totals.grossAmount).toBe(10_000);
    expect(out.totals.refundedAmount).toBe(4_000);
    expect(out.totals.netRevenue).toBe(6_000);
  });

  it("excludes failed payments from the financial totals but keeps them in rows", () => {
    const payments: Payment[] = [
      makePayment({ id: "p1", status: "succeeded", amount: 10_000 }),
      makePayment({
        id: "p2",
        status: "failed",
        amount: 7_000,
        registrationId: "reg-2",
      }),
    ];
    const out = computeReconciliation(payments);
    expect(out.rows.find((r) => r.status === "failed")).toBeDefined();
    expect(out.totals.grossAmount).toBe(10_000); // failed not counted
    expect(out.totals.paidRegistrations).toBe(1);
  });

  it("excludes 'processing' + 'expired' payments from the financial totals (Phase-2 states)", () => {
    // Develop's payments overhaul introduced two new PaymentStatus
    // values: 'processing' (user redirected to provider, awaiting
    // callback) and 'expired' (TTL elapsed). Neither contributes to
    // revenue — they MUST stay out of the financial totals while
    // remaining visible as rows in the reconciliation matrix.
    const payments: Payment[] = [
      makePayment({ id: "p1", status: "succeeded", amount: 10_000 }),
      makePayment({
        id: "p2",
        status: "processing",
        amount: 5_000,
        registrationId: "reg-2",
      }),
      makePayment({
        id: "p3",
        status: "expired",
        amount: 7_000,
        registrationId: "reg-3",
      }),
    ];
    const out = computeReconciliation(payments);
    expect(out.rows.find((r) => r.status === "processing")).toBeDefined();
    expect(out.rows.find((r) => r.status === "expired")).toBeDefined();
    expect(out.totals.grossAmount).toBe(10_000);
    expect(out.totals.paidRegistrations).toBe(1);
  });

  it("counts distinct registrationIds in paidRegistrations (not retries)", () => {
    const payments: Payment[] = [
      // Retry on the same registration → 1 paid registration, not 2.
      makePayment({ id: "p1", registrationId: "reg-1", amount: 10_000 }),
      makePayment({ id: "p2", registrationId: "reg-1", amount: 10_000 }),
      makePayment({ id: "p3", registrationId: "reg-2", amount: 5_000 }),
    ];
    const out = computeReconciliation(payments);
    expect(out.totals.paidRegistrations).toBe(2);
  });

  it("computes platformFee = round(netRevenue × PLATFORM_FEE_RATE) and payoutAmount", () => {
    const payments: Payment[] = [makePayment({ amount: 100_000, refundedAmount: 0 })];
    const out = computeReconciliation(payments);
    // Default PLATFORM_FEE_RATE = 0.05 → fee = 5000, payout = 95000.
    expect(out.totals.platformFee).toBe(5_000);
    expect(out.totals.payoutAmount).toBe(95_000);
  });

  it("stable-sorts rows by method then status", () => {
    const payments: Payment[] = [
      makePayment({ id: "p1", method: "wave", status: "succeeded" }),
      makePayment({ id: "p2", method: "wave", status: "failed" }),
      makePayment({
        id: "p3",
        method: "orange_money",
        status: "succeeded",
        registrationId: "reg-3",
      }),
    ];
    const out = computeReconciliation(payments);
    expect(out.rows.map((r) => `${r.method}|${r.status}`)).toEqual([
      "orange_money|succeeded",
      "wave|failed",
      "wave|succeeded",
    ]);
  });

  it("tracks lastPaymentAt as the latest completedAt across the dataset", () => {
    const payments: Payment[] = [
      makePayment({ id: "p1", completedAt: "2026-04-01T10:00:00.000Z" }),
      makePayment({
        id: "p2",
        completedAt: "2026-04-03T10:00:00.000Z",
        registrationId: "reg-2",
      }),
      makePayment({
        id: "p3",
        completedAt: "2026-04-02T10:00:00.000Z",
        registrationId: "reg-3",
      }),
    ];
    const out = computeReconciliation(payments);
    expect(out.lastPaymentAt).toBe("2026-04-03T10:00:00.000Z");
  });
});
