import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSuperAdmin } from "@/__tests__/factories";

// ─── Mocks (vi.hoisted so they're available inside vi.mock factories) ──────

const { mockBatchUpdate, mockBatchSet, mockBatchCommit, mockBatch, mockQueryGet, mockCollection } =
  vi.hoisted(() => {
    const _mockBatchUpdate = vi.fn();
    const _mockBatchSet = vi.fn();
    const _mockBatchCommit = vi.fn(async () => undefined);
    const _mockBatch = vi.fn(() => ({
      update: _mockBatchUpdate,
      set: _mockBatchSet,
      commit: _mockBatchCommit,
    }));
    const _mockQueryGet = vi.fn();

    // Single chained query stub — `where().where().orderBy().limit()`
    // (and optional `.startAfter(cursor)`) all return the same builder so
    // any call ordering resolves to the same `.get()` mock.
    const builder: Record<string, unknown> = {};
    builder.where = vi.fn(() => builder);
    builder.orderBy = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.startAfter = vi.fn(() => builder);
    builder.get = _mockQueryGet;

    // The handler calls `db.collection(BALANCE_TRANSACTIONS).where(...)…`
    // for the sweep AND `db.collection(AUDIT_LOGS).doc()` for the audit
    // ref. The `_collection` tag on the synthetic ref lets assertions
    // distinguish ledger updates (balanceTransactions) from audit
    // writes (auditLogs).
    let auditDocCounter = 0;
    const _mockCollection = vi.fn((name: string) => ({
      ...builder,
      doc: vi.fn(() => ({
        id: name === "auditLogs" ? `audit-${auditDocCounter++}` : `${name}-auto`,
        _collection: name,
      })),
    }));

    return {
      mockBatchUpdate: _mockBatchUpdate,
      mockBatchSet: _mockBatchSet,
      mockBatchCommit: _mockBatchCommit,
      mockBatch: _mockBatch,
      mockQueryGet: _mockQueryGet,
      mockCollection: _mockCollection,
    };
  });

vi.mock("@/config/firebase", () => ({
  db: {
    collection: (name: string) => mockCollection(name),
    batch: () => mockBatch(),
  },
  COLLECTIONS: {
    BALANCE_TRANSACTIONS: "balanceTransactions",
    AUDIT_LOGS: "auditLogs",
  },
}));

import { releaseAvailableFundsHandler, runReleaseSweep } from "../release-available-funds";
import type { JobContext } from "../../types";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeBalanceSnap(
  id: string,
  data: Record<string, unknown>,
): {
  id: string;
  ref: { id: string; _collection: string };
  data: () => Record<string, unknown>;
} {
  return { id, ref: { id, _collection: "balanceTransactions" }, data: () => data };
}

function buildContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    signal: new AbortController().signal,
    actor: buildSuperAdmin(),
    runId: "run-test-1",
    log: vi.fn(),
    ...overrides,
  };
}

const NOW = "2026-04-26T12:00:00.000Z";
const ONE_HOUR_MS = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(new Date(NOW).getTime() + offsetMs).toISOString();

beforeEach(() => {
  // mockReset() (not mockClear) clears both call history AND the queued
  // mockResolvedValueOnce stack. Without this, a previous test's leftover
  // queued responses would leak into the next test. Same pattern as
  // expire-stale-payments.test.ts.
  mockBatchUpdate.mockReset();
  mockBatchSet.mockReset();
  mockBatchCommit.mockReset();
  mockBatchCommit.mockResolvedValue(undefined);
  mockBatch.mockClear();
  mockQueryGet.mockReset();
});

// ─── Captured audit-write helper ─────────────────────────────────────────
// `mockBatchSet` is called for each audit row: `(ref, data)`. Filter to
// auditLogs writes and return their data payloads in the order written.
function auditDataPayloads() {
  return mockBatchSet.mock.calls
    .filter(
      ([ref]) =>
        typeof ref === "object" &&
        ref !== null &&
        (ref as { _collection?: string })._collection === "auditLogs",
    )
    .map(([, data]) => data as Record<string, unknown>);
}

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
      asOf: NOW,
      foo: "bar",
    });
    expect(result.success).toBe(false);
  });

  it("accepts the empty input shape (defaults applied at runtime)", () => {
    const result = releaseAvailableFundsHandler.inputSchema!.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("runReleaseSweep — happy path", () => {
  it("flips pending entries past availableOn to available and writes per-org audit rows", async () => {
    const docs = [
      makeBalanceSnap("bt-due-1", {
        organizationId: "org-1",
        status: "pending",
        availableOn: iso(-ONE_HOUR_MS),
        amount: 17_100,
      }),
      makeBalanceSnap("bt-due-fee", {
        organizationId: "org-1",
        status: "pending",
        availableOn: iso(-ONE_HOUR_MS),
        amount: -900,
      }),
    ];
    mockQueryGet.mockResolvedValueOnce({ empty: false, size: docs.length, docs });
    // No second page → loop exits via `snap.size < pageSize` short-circuit.

    const result = await runReleaseSweep({ asOf: NOW }, { runId: "run-1" });

    expect(result.released).toBe(2);
    expect(result.organizationsAudited).toBe(1);
    expect(result.asOf).toBe(NOW);

    // Both flipped to available.
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate.mock.calls[0]?.[1]).toEqual({ status: "available" });
    expect(mockBatchUpdate.mock.calls[1]?.[1]).toEqual({ status: "available" });

    // One audit row per org with the right shape.
    const audits = auditDataPayloads();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "balance_transaction.released",
      actorId: "system:balance-release",
      organizationId: "org-1",
      requestId: "run-1",
      resourceType: "organization",
      resourceId: "org-1",
    });
    const details = audits[0]!.details as Record<string, unknown>;
    expect(details.count).toBe(2);
    // Net = +17 100 − 900 = +16 200 (the org's net release).
    expect(details.netAmount).toBe(16_200);
    expect(details.sampleEntryIds).toEqual(["bt-due-1", "bt-due-fee"]);
    expect(details.truncated).toBe(false);
  });

  it("returns zero-state without writing audit when no entries are due", async () => {
    mockQueryGet.mockResolvedValueOnce({ empty: true, size: 0, docs: [] });

    const result = await runReleaseSweep({ asOf: NOW });

    expect(result.released).toBe(0);
    expect(result.organizationsAudited).toBe(0);
    expect(auditDataPayloads()).toHaveLength(0);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });
});

describe("runReleaseSweep — boundary + edge cases", () => {
  it("aggregates rows by organizationId across multiple orgs", async () => {
    const docs = [
      makeBalanceSnap("bt-A-1", {
        organizationId: "org-A",
        status: "pending",
        availableOn: iso(-ONE_HOUR_MS),
        amount: 10_000,
      }),
      makeBalanceSnap("bt-A-2", {
        organizationId: "org-A",
        status: "pending",
        availableOn: iso(-ONE_HOUR_MS),
        amount: 5_000,
      }),
      makeBalanceSnap("bt-B-1", {
        organizationId: "org-B",
        status: "pending",
        availableOn: iso(-ONE_HOUR_MS),
        amount: 7_500,
      }),
    ];
    mockQueryGet.mockResolvedValueOnce({ empty: false, size: docs.length, docs });

    const result = await runReleaseSweep({ asOf: NOW });

    expect(result.released).toBe(3);
    expect(result.organizationsAudited).toBe(2);

    const audits = auditDataPayloads();
    expect(audits).toHaveLength(2);
    const byOrg = new Map(
      audits.map((a) => [a.organizationId as string, a.details as Record<string, unknown>]),
    );
    expect(byOrg.get("org-A")?.count).toBe(2);
    expect(byOrg.get("org-A")?.netAmount).toBe(15_000);
    expect(byOrg.get("org-B")?.count).toBe(1);
    expect(byOrg.get("org-B")?.netAmount).toBe(7_500);
  });

  it("caps sampleEntryIds at 50 + sets truncated:true when more entries were released", async () => {
    const docs = Array.from({ length: 75 }, (_, i) =>
      makeBalanceSnap(`bt-${String(i).padStart(3, "0")}`, {
        organizationId: "org-1",
        status: "pending",
        availableOn: iso(-ONE_HOUR_MS),
        amount: 1_000,
      }),
    );
    mockQueryGet.mockResolvedValueOnce({ empty: false, size: docs.length, docs });

    const result = await runReleaseSweep({ asOf: NOW });

    expect(result.released).toBe(75);
    expect(result.organizationsAudited).toBe(1);
    const details = auditDataPayloads()[0]!.details as Record<string, unknown>;
    expect(details.count).toBe(75);
    expect((details.sampleEntryIds as string[]).length).toBe(50);
    expect(details.truncated).toBe(true);
  });

  it("respects the maxEntries cap and stops after the requested count", async () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      makeBalanceSnap(`bt-${i}`, {
        organizationId: "org-1",
        status: "pending",
        availableOn: iso(-ONE_HOUR_MS),
        amount: 100,
      }),
    );
    mockQueryGet.mockResolvedValueOnce({ empty: false, size: docs.length, docs });

    const result = await runReleaseSweep({ asOf: NOW, maxEntries: 5 });

    expect(result.released).toBe(5);
  });

  it("aborts immediately when ctx.signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    await expect(runReleaseSweep({ asOf: NOW }, { signal: ac.signal })).rejects.toThrow("aborted");
    expect(mockQueryGet).not.toHaveBeenCalled();
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });
});

describe("releaseAvailableFundsHandler.run — integration with runner ctx", () => {
  it("formats the human-readable summary + tags audit rows with admin-job runId", async () => {
    const docs = [
      makeBalanceSnap("bt-1", {
        organizationId: "org-1",
        status: "pending",
        availableOn: iso(-ONE_HOUR_MS),
        amount: 5_000,
      }),
    ];
    mockQueryGet.mockResolvedValueOnce({ empty: false, size: docs.length, docs });
    const ctx = buildContext({ runId: "run-42" });

    const summary = await releaseAvailableFundsHandler.run({}, ctx);

    expect(summary).toContain("Released 1 ledger entries");
    expect(summary).toContain("1 organization(s)");
    // The runner-context runId is prefixed with `admin-job:` on audit
    // rows so audit consumers can tell admin-triggered runs apart from
    // cron ones (which use `system:cron-...`).
    const audits = auditDataPayloads();
    expect(audits[0]?.requestId).toBe("admin-job:run-42");
  });

  it("reports the no-op summary when nothing is due", async () => {
    mockQueryGet.mockResolvedValueOnce({ empty: true, size: 0, docs: [] });
    const ctx = buildContext();

    const summary = await releaseAvailableFundsHandler.run({}, ctx);

    expect(summary).toMatch(/No pending balance entries due/);
  });
});
