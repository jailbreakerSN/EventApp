import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSuperAdmin } from "@/__tests__/factories";

// ─── Mocks (vi.hoisted so they're available inside vi.mock factories) ──────

const {
  mockBatchUpdate,
  mockBatchCommit,
  mockBatch,
  mockQueryGet,
  mockBusEmit,
  mockCollection,
  paymentDocs,
} = vi.hoisted(() => {
  const _mockBatchUpdate = vi.fn();
  const _mockBatchCommit = vi.fn(async () => undefined);
  const _mockBatch = vi.fn(() => ({
    update: _mockBatchUpdate,
    commit: _mockBatchCommit,
  }));
  const _mockQueryGet = vi.fn();
  const _mockBusEmit = vi.fn();
  const _paymentDocs: Array<{ id: string; data: Record<string, unknown> }> = [];

  // Single chained query stub — `where().where().orderBy().limit()` (and
  // optional `.startAfter(cursor)`) all return the same builder so any
  // call ordering resolves to the same `.get()` mock.
  const builder: Record<string, unknown> = {};
  builder.where = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.startAfter = vi.fn(() => builder);
  builder.get = _mockQueryGet;

  const _mockCollection = vi.fn((name: string) => {
    // For the per-doc `db.collection(REGISTRATIONS).doc(regId)` calls
    // inside the handler, return a stub whose `.doc()` produces a
    // fake DocumentReference. The actual write goes through
    // `batch.update(ref, { … })` which we capture on `mockBatchUpdate`.
    return {
      ...builder,
      doc: vi.fn((id: string) => ({ id, _collection: name })),
    };
  });

  return {
    mockBatchUpdate: _mockBatchUpdate,
    mockBatchCommit: _mockBatchCommit,
    mockBatch: _mockBatch,
    mockQueryGet: _mockQueryGet,
    mockBusEmit: _mockBusEmit,
    mockCollection: _mockCollection,
    paymentDocs: _paymentDocs,
  };
});

vi.mock("@/config/firebase", () => ({
  db: {
    collection: (name: string) => mockCollection(name),
    batch: () => mockBatch(),
  },
  COLLECTIONS: {
    PAYMENTS: "payments",
    REGISTRATIONS: "registrations",
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: mockBusEmit },
}));

import { expireStalePaymentsHandler } from "../expire-stale-payments";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makePaymentSnap(id: string, data: Record<string, unknown>): {
  id: string;
  ref: { id: string; _collection: string };
  data: () => Record<string, unknown>;
} {
  return {
    id,
    ref: { id, _collection: "payments" },
    data: () => data,
  };
}

function buildCtx(overrides: Partial<Parameters<typeof expireStalePaymentsHandler.run>[1]> = {}) {
  return {
    actor: buildSuperAdmin(),
    runId: "run-test-1",
    signal: new AbortController().signal,
    log: vi.fn(),
    ...overrides,
  } as Parameters<typeof expireStalePaymentsHandler.run>[1];
}

describe("expire-stale-payments handler", () => {
  beforeEach(() => {
    // mockReset() (not mockClear) resets BOTH the call history AND
    // the queued mockResolvedValueOnce / mockReturnValueOnce stack.
    // Without this, a test that consumed N once-values leaves an
    // empty queue for subsequent tests, and the next call to the
    // mock returns undefined → the handler crashes on `snap.empty`.
    mockBatchUpdate.mockReset();
    mockBatchCommit.mockReset();
    mockBatchCommit.mockResolvedValue(undefined);
    mockQueryGet.mockReset();
    mockBusEmit.mockReset();
    paymentDocs.length = 0;
  });

  // ── Happy path ──────────────────────────────────────────────────────────
  it("flips matching payments + cancels their registrations atomically", async () => {
    // Two stale payments, both with a registrationId.
    const docs = [
      makePaymentSnap("pay-1", {
        registrationId: "reg-1",
        status: "pending",
        initiatedAt: "2026-04-25T00:00:00.000Z",
      }),
      makePaymentSnap("pay-2", {
        registrationId: "reg-2",
        status: "processing",
        initiatedAt: "2026-04-24T00:00:00.000Z",
      }),
    ];
    mockQueryGet.mockResolvedValueOnce({ empty: false, docs });
    // Second page is empty → loop exits.
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });

    const ctx = buildCtx();
    const summary = await expireStalePaymentsHandler.run(
      { staleAfterHours: 24, maxRows: 1000 },
      ctx,
    );

    expect(summary).toMatch(/Expired 2 payment\(s\)/);
    // 2 payment updates + 2 registration updates = 4 batch.update calls.
    expect(mockBatchUpdate).toHaveBeenCalledTimes(4);
    // First call: update Payment with status=expired + failureReason
    expect(mockBatchUpdate).toHaveBeenNthCalledWith(
      1,
      docs[0].ref,
      expect.objectContaining({
        status: "expired",
        failureReason: expect.stringContaining("expiré"),
      }),
    );
    // Second call: cancel Registration
    expect(mockBatchUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "reg-1", _collection: "registrations" }),
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  // ── Idempotency ─────────────────────────────────────────────────────────
  it("is a no-op when no rows match (already expired or none stale)", async () => {
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });

    const summary = await expireStalePaymentsHandler.run(
      { staleAfterHours: 24, maxRows: 1000 },
      buildCtx(),
    );

    expect(summary).toMatch(/Expired 0 payment\(s\)/);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockBusEmit).not.toHaveBeenCalled();
  });

  // ── Domain event per batch ──────────────────────────────────────────────
  it("emits exactly one payment.bulk_expired per committed batch — P1-21", async () => {
    const docs = [
      makePaymentSnap("pay-A", { registrationId: "reg-A", status: "pending" }),
      makePaymentSnap("pay-B", { registrationId: "reg-B", status: "processing" }),
    ];
    mockQueryGet.mockResolvedValueOnce({ empty: false, docs });
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });

    await expireStalePaymentsHandler.run({ staleAfterHours: 24, maxRows: 1000 }, buildCtx());

    expect(mockBusEmit).toHaveBeenCalledTimes(1);
    expect(mockBusEmit).toHaveBeenCalledWith(
      "payment.bulk_expired",
      expect.objectContaining({
        actorUid: expect.any(String),
        jobKey: "expire-stale-payments",
        runId: "run-test-1",
        count: 2,
        cutoffIso: expect.any(String),
        processedAt: expect.any(String),
      }),
    );
  });

  // ── Abort signal honoured ───────────────────────────────────────────────
  it("aborts immediately when ctx.signal is already tripped", async () => {
    // The handler checks `ctx.signal.aborted` at the top of every
    // while-loop iteration. Pre-abort the signal so the first check
    // throws before any Firestore read happens — proves the handler
    // honours the runner's 5-minute timeout AND cooperative abort
    // (operator force-cancel).
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(
      expireStalePaymentsHandler.run(
        { staleAfterHours: 24, maxRows: 10000 },
        buildCtx({ signal: ctrl.signal }),
      ),
    ).rejects.toThrow("aborted");

    // Crucially: NO Firestore query was issued.
    expect(mockQueryGet).not.toHaveBeenCalled();
  });

  // ── No registrationId branch ────────────────────────────────────────────
  it("expires the payment even when registrationId is missing (dangling row)", async () => {
    const docs = [
      makePaymentSnap("pay-no-reg", {
        // registrationId absent — dangling Payment from a partial commit.
        status: "pending",
        initiatedAt: "2026-04-25T00:00:00.000Z",
      }),
    ];
    mockQueryGet.mockResolvedValueOnce({ empty: false, docs });
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });

    const summary = await expireStalePaymentsHandler.run(
      { staleAfterHours: 24, maxRows: 1000 },
      buildCtx(),
    );

    expect(summary).toMatch(/Expired 1 payment/);
    // Only the payment update — no registration write.
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      docs[0].ref,
      expect.objectContaining({ status: "expired" }),
    );
  });

  // ── Input schema bounds ─────────────────────────────────────────────────
  it("rejects staleAfterHours > 720 (30-day safety cap)", () => {
    const result = expireStalePaymentsHandler.inputSchema!.safeParse({
      staleAfterHours: 721,
      maxRows: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects staleAfterHours <= 0", () => {
    const result = expireStalePaymentsHandler.inputSchema!.safeParse({
      staleAfterHours: 0,
      maxRows: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects extra fields (.strict())", () => {
    const result = expireStalePaymentsHandler.inputSchema!.safeParse({
      staleAfterHours: 24,
      maxRows: 100,
      sneaky: "value",
    });
    expect(result.success).toBe(false);
  });

  it("applies defaults when input is empty", () => {
    const result = expireStalePaymentsHandler.inputSchema!.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.staleAfterHours).toBe(24);
      expect(result.data.maxRows).toBe(1000);
    }
  });
});
