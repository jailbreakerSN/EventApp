import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReconciliationTable } from "../ReconciliationTable";
import type { ReconciliationSummary } from "@teranga/shared-types";

// ─── ReconciliationTable — render contract ────────────────────────────────
//
// Pure presentational component. We exercise the empty + populated
// branches + the totals row. Loading is its own skeleton path.

const baseSummary: ReconciliationSummary = {
  eventId: "evt-1",
  organizationId: "org-1",
  rows: [
    {
      method: "wave",
      status: "succeeded",
      count: 10,
      totalAmount: 100_000,
      refundedAmount: 0,
      netAmount: 100_000,
    },
    {
      method: "orange_money",
      status: "succeeded",
      count: 5,
      totalAmount: 50_000,
      refundedAmount: 5_000,
      netAmount: 45_000,
    },
    {
      method: "wave",
      status: "failed",
      count: 1,
      totalAmount: 10_000,
      refundedAmount: 0,
      netAmount: 10_000,
    },
  ],
  totals: {
    grossAmount: 150_000,
    refundedAmount: 5_000,
    netRevenue: 145_000,
    platformFee: 7_250,
    payoutAmount: 137_750,
    paidRegistrations: 15,
    currency: "XOF",
  },
  lastPaymentAt: "2026-04-26T18:00:00.000Z",
  computedAt: "2026-04-27T10:00:00.000Z",
};

describe("ReconciliationTable", () => {
  it("renders the loading skeleton when isLoading", () => {
    const { container } = render(<ReconciliationTable data={undefined} isLoading={true} />);
    // No <table> while loading.
    expect(container.querySelector("table")).toBeNull();
  });

  it("renders the empty-state copy when there are no rows", () => {
    const { container } = render(
      <ReconciliationTable data={{ ...baseSummary, rows: [] }} isLoading={false} />,
    );
    expect(container.textContent).toContain("Aucun paiement à rapprocher");
  });

  it("renders one tbody row per (method, status) bucket plus a totals row", () => {
    const { container } = render(<ReconciliationTable data={baseSummary} isLoading={false} />);
    const rows = container.querySelectorAll("tbody tr");
    // 3 data rows + 1 totals = 4
    expect(rows.length).toBe(4);
  });

  it("formats monetary cells with regular spaces (no narrow-no-break)", () => {
    const { container } = render(<ReconciliationTable data={baseSummary} isLoading={false} />);
    expect(container.textContent).toContain("100 000 XOF");
    // The total payout net.
    expect(container.textContent).toContain("145 000 XOF");
  });

  it("renders the FR status pill labels", () => {
    const { container } = render(<ReconciliationTable data={baseSummary} isLoading={false} />);
    expect(container.textContent).toContain("Succès");
    expect(container.textContent).toContain("Échec");
  });

  it("surfaces the last payment timestamp footer when provided", () => {
    const { container } = render(<ReconciliationTable data={baseSummary} isLoading={false} />);
    expect(container.textContent).toContain("Dernier paiement enregistré");
  });
});
