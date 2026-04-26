import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSuperAdmin } from "@/__tests__/factories";
import type { JobContext } from "../../types";

// ─── release-available-funds handler tests ─────────────────────────────────
//
// The handler is a thin wrapper around `balanceService.releaseAvailableFunds`.
// These tests cover ONLY the wrapper concerns:
//   - Descriptor pinning (i18n labels, exampleInput, danger note)
//   - Zod input schema (`.strict()`, `asOf` upper bound)
//   - Delegation: arg forwarding + summary formatting
//
// The actual sweep / event-emission semantics live in
// `apps/api/src/services/__tests__/balance-release.test.ts`.

const { mockReleaseAvailableFunds } = vi.hoisted(() => ({
  mockReleaseAvailableFunds: vi.fn(),
}));

vi.mock("@/services/balance.service", () => ({
  balanceService: { releaseAvailableFunds: mockReleaseAvailableFunds },
}));

import { releaseAvailableFundsHandler } from "../release-available-funds";

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
  mockReleaseAvailableFunds.mockReset();
});

// ─── Descriptor + schema ───────────────────────────────────────────────────

describe("release-available-funds handler — descriptor", () => {
  it("declares the canonical descriptor (jobKey, fr/en, exampleInput, no danger note)", () => {
    expect(releaseAvailableFundsHandler.descriptor).toMatchObject({
      jobKey: "release-available-funds",
      titleFr: "Libérer les fonds disponibles",
      titleEn: "Release available funds",
      hasInput: true,
      exampleInput: {},
      dangerNoteFr: null,
      dangerNoteEn: null,
    });
  });

  it("rejects unknown input fields via .strict()", () => {
    const result = releaseAvailableFundsHandler.inputSchema!.safeParse({
      asOf: "2026-04-26T10:00:00.000Z",
      foo: "bar",
    });
    expect(result.success).toBe(false);
  });

  it("accepts the empty input shape (defaults applied at runtime)", () => {
    const result = releaseAvailableFundsHandler.inputSchema!.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts asOf within the 5-minute future grace", () => {
    const inGrace = new Date(Date.now() + 60_000).toISOString();
    const result = releaseAvailableFundsHandler.inputSchema!.safeParse({ asOf: inGrace });
    expect(result.success).toBe(true);
  });

  // ─── M2 (senior review) — asOf upper bound ─────────────────────────────
  it("REJECTS asOf more than 5 minutes in the future (operator-typo guard)", () => {
    // Worst case: an operator types `3026` instead of `2026` and tries
    // to release every pending entry on the platform. The schema must
    // catch this BEFORE the service method runs.
    const farFuture = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const result = releaseAvailableFundsHandler.inputSchema!.safeParse({ asOf: farFuture });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("future");
    }
  });

  it("clamps maxEntries at 50_000", () => {
    const ok = releaseAvailableFundsHandler.inputSchema!.safeParse({ maxEntries: 50_000 });
    const tooBig = releaseAvailableFundsHandler.inputSchema!.safeParse({ maxEntries: 50_001 });
    expect(ok.success).toBe(true);
    expect(tooBig.success).toBe(false);
  });
});

// ─── Delegation ────────────────────────────────────────────────────────────

describe("release-available-funds handler — run() delegation", () => {
  it("forwards input + ctx to balanceService.releaseAvailableFunds with admin-job: runId prefix", async () => {
    mockReleaseAvailableFunds.mockResolvedValueOnce({
      released: 3,
      organizationsAudited: 2,
      asOf: "2026-04-26T12:00:00.000Z",
    });
    const ctx = buildContext({ runId: "run-42" });

    const summary = await releaseAvailableFundsHandler.run({}, ctx);

    expect(mockReleaseAvailableFunds).toHaveBeenCalledTimes(1);
    const arg = mockReleaseAvailableFunds.mock.calls[0]![0];
    expect(arg).toMatchObject({
      runId: "admin-job:run-42",
      signal: ctx.signal,
    });
    expect(summary).toContain("Released 3 ledger entries");
    expect(summary).toContain("2 organization(s)");
  });

  it("forwards `asOf` and `maxEntries` when supplied", async () => {
    mockReleaseAvailableFunds.mockResolvedValueOnce({
      released: 0,
      organizationsAudited: 0,
      asOf: "2026-04-26T11:55:00.000Z",
    });
    const ctx = buildContext();

    await releaseAvailableFundsHandler.run(
      { asOf: "2026-04-26T11:55:00.000Z", maxEntries: 100 },
      ctx,
    );

    const arg = mockReleaseAvailableFunds.mock.calls[0]![0];
    expect(arg.asOf).toBe("2026-04-26T11:55:00.000Z");
    expect(arg.maxEntries).toBe(100);
  });

  it("formats the no-op summary when nothing is due", async () => {
    mockReleaseAvailableFunds.mockResolvedValueOnce({
      released: 0,
      organizationsAudited: 0,
      asOf: "2026-04-26T12:00:00.000Z",
    });

    const summary = await releaseAvailableFundsHandler.run({}, buildContext());
    expect(summary).toMatch(/No pending balance entries due/);
  });

  it("aborts immediately when ctx.signal is already aborted (no service call)", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      releaseAvailableFundsHandler.run({}, buildContext({ signal: ac.signal })),
    ).rejects.toThrow("aborted");
    expect(mockReleaseAvailableFunds).not.toHaveBeenCalled();
  });

  it("propagates errors thrown by the service (per-run failure surfaces in the runner)", async () => {
    mockReleaseAvailableFunds.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await expect(releaseAvailableFundsHandler.run({}, buildContext())).rejects.toThrow(
      "Firestore unavailable",
    );
  });
});
