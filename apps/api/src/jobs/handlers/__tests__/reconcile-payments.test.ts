import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSuperAdmin } from "@/__tests__/factories";
import type { JobContext } from "../../types";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// `reconcilePaymentsHandler.run` lazy-imports `paymentService` (same
// pattern as the internal route — avoids a circular require when this
// file lands in the registry-listing endpoint at module-load time). We
// intercept that lazy import so tests don't pull in event-bus, repos
// or config at module-init time.

const { mockReconcileStuckPayments } = vi.hoisted(() => ({
  mockReconcileStuckPayments: vi.fn(),
}));

vi.mock("@/services/payment.service", () => ({
  paymentService: {
    reconcileStuckPayments: mockReconcileStuckPayments,
  },
}));

import { reconcilePaymentsHandler } from "../reconcile-payments";

function buildContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    signal: new AbortController().signal,
    actor: buildSuperAdmin(),
    runId: "run-test-1",
    log: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockReconcileStuckPayments.mockReset();
});

describe("reconcile-payments handler — descriptor", () => {
  it("declares the canonical descriptor (jobKey, fr/en, exampleInput, danger note)", () => {
    expect(reconcilePaymentsHandler.descriptor).toMatchObject({
      jobKey: "reconcile-payments",
      titleFr: "Réconcilier les paiements bloqués",
      titleEn: "Reconcile stuck payments",
      hasInput: true,
      // Danger note explains the provider-quota concern.
      dangerNoteFr: expect.stringContaining("quota"),
      dangerNoteEn: expect.stringContaining("quota"),
    });
  });

  it("rejects unknown input fields via .strict()", () => {
    const result = reconcilePaymentsHandler.inputSchema!.safeParse({
      windowMinMs: 5 * 60 * 1000,
      foo: "bar",
    });
    expect(result.success).toBe(false);
  });

  it("rejects windowMinMs >= windowMaxMs (cross-field guard)", () => {
    const result = reconcilePaymentsHandler.inputSchema!.safeParse({
      windowMinMs: 25 * 60 * 1000,
      windowMaxMs: 5 * 60 * 1000,
    });
    expect(result.success).toBe(false);
  });

  it("accepts the empty input shape (defaults applied at runtime)", () => {
    const result = reconcilePaymentsHandler.inputSchema!.safeParse({});
    expect(result.success).toBe(true);
  });

  it("clamps batchSize at 200", () => {
    const ok = reconcilePaymentsHandler.inputSchema!.safeParse({ batchSize: 200 });
    const tooBig = reconcilePaymentsHandler.inputSchema!.safeParse({ batchSize: 201 });
    expect(ok.success).toBe(true);
    expect(tooBig.success).toBe(false);
  });
});

describe("reconcile-payments handler — run()", () => {
  it("delegates to paymentService.reconcileStuckPayments and returns a human summary", async () => {
    mockReconcileStuckPayments.mockResolvedValueOnce({
      scanned: 5,
      finalizedSucceeded: 2,
      finalizedFailed: 1,
      stillPending: 2,
      errored: 0,
    });

    const summary = await reconcilePaymentsHandler.run({}, buildContext());

    expect(mockReconcileStuckPayments).toHaveBeenCalledTimes(1);
    expect(mockReconcileStuckPayments).toHaveBeenCalledWith({});
    expect(summary).toContain("Scanned 5 processing payment(s)");
    expect(summary).toContain("2 succeeded");
    expect(summary).toContain("1 failed");
    expect(summary).toContain("2 still pending");
    expect(summary).toContain("0 errored");
  });

  it("forwards windowMinMs / windowMaxMs / batchSize to the service", async () => {
    mockReconcileStuckPayments.mockResolvedValueOnce({
      scanned: 0,
      finalizedSucceeded: 0,
      finalizedFailed: 0,
      stillPending: 0,
      errored: 0,
    });

    await reconcilePaymentsHandler.run(
      { windowMinMs: 60_000, windowMaxMs: 30 * 60_000, batchSize: 100 },
      buildContext(),
    );

    expect(mockReconcileStuckPayments).toHaveBeenCalledWith({
      windowMinMs: 60_000,
      windowMaxMs: 30 * 60_000,
      batchSize: 100,
    });
  });

  it("aborts immediately when ctx.signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    await expect(
      reconcilePaymentsHandler.run({}, buildContext({ signal: ac.signal })),
    ).rejects.toThrow("aborted");
    expect(mockReconcileStuckPayments).not.toHaveBeenCalled();
  });

  it("propagates errors thrown by the service (per-run failure surfaces in the runner)", async () => {
    mockReconcileStuckPayments.mockRejectedValueOnce(new Error("provider unreachable"));

    await expect(reconcilePaymentsHandler.run({}, buildContext())).rejects.toThrow(
      "provider unreachable",
    );
  });
});
