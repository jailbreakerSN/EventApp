import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAuthUser, buildSuperAdmin } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// The service under test composes the webhookEvents repo, paymentService
// .handleWebhook, the rate limiter, the audit log, and the domain event
// bus. Each is mocked at the module boundary so tests can drive the
// full state machine without Firestore.

const hoisted = vi.hoisted(() => ({
  mockRepoFindById: vi.fn(),
  mockRepoUpsert: vi.fn().mockResolvedValue(undefined),
  mockRepoUpdate: vi.fn().mockResolvedValue(undefined),
  mockRepoList: vi.fn(),
  mockHandleWebhook: vi.fn().mockResolvedValue(undefined),
  mockRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  mockBusEmit: vi.fn(),
  mockUsersDocGet: vi.fn().mockResolvedValue({ exists: false }),
  // Transactional firestore: record() + replay() now both run
  // read-then-write inside `db.runTransaction`. The test captures
  // the per-ref tx.get/set/update calls so each assertion can still
  // inspect what landed (FAIL-1 + FAIL-2 fixes).
  mockEventRefSet: vi.fn(),
  mockEventRefUpdate: vi.fn(),
  mockEventRefGet: vi.fn(),
  mockAuditRefSet: vi.fn(),
  // Collection helpers: auditRef id generator is called via
  // `.collection(AUDIT_LOGS).doc()` with no id so the transaction
  // has a fresh ref to set. We don't assert the auto-id shape.
  mockAuditDocNoId: vi.fn(() => ({
    id: "audit-auto",
    set: hoisted.mockAuditRefSet,
  })),
}));

const {
  mockRepoFindById,
  mockRepoUpsert,
  mockRepoUpdate,
  mockRepoList,
  mockHandleWebhook,
  mockRateLimit,
  mockBusEmit,
  mockEventRefSet,
  mockEventRefUpdate,
  mockEventRefGet,
  mockAuditRefSet,
} = hoisted;

// Convenience: each tx.get on the webhookEvents ref returns this.
// Tests overwrite for the tx-level idempotency branch.
function txGetStub(exists: boolean, data?: Record<string, unknown>) {
  mockEventRefGet.mockResolvedValueOnce({ exists, data: () => data });
}

vi.mock("@/repositories/webhook-events.repository", () => ({
  webhookEventsRepository: {
    findById: hoisted.mockRepoFindById,
    upsert: hoisted.mockRepoUpsert,
    update: hoisted.mockRepoUpdate,
    list: hoisted.mockRepoList,
  },
  webhookEventDocId: (p: string, tx: string, s: string) => `${p}__${tx}__${s}`,
}));

vi.mock("@/services/payment.service", () => ({
  paymentService: { handleWebhook: hoisted.mockHandleWebhook },
}));

vi.mock("@/services/rate-limit.service", () => ({
  rateLimit: hoisted.mockRateLimit,
}));

vi.mock("@/events/event-bus", () => ({ eventBus: { emit: hoisted.mockBusEmit } }));
vi.mock("@/context/request-context", () => ({ getRequestId: () => "req-test" }));

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id?: string) => {
        if (name === "users") {
          return { get: hoisted.mockUsersDocGet };
        }
        if (name === "webhookEvents") {
          return {
            id: id ?? "webhook-ref",
            get: hoisted.mockEventRefGet,
            set: hoisted.mockEventRefSet,
            update: hoisted.mockEventRefUpdate,
          };
        }
        if (name === "auditLogs") {
          return id ? { id, set: hoisted.mockAuditRefSet } : hoisted.mockAuditDocNoId();
        }
        return { id: id ?? "x" };
      }),
    })),
    runTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      // Minimal tx: .get delegates to the ref's own get; .set/.update
      // delegate to the ref-level spies so assertions stay readable.
      const tx = {
        get: (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (data: unknown) => unknown }, data: unknown) => ref.set(data),
        update: (ref: { update: (data: unknown) => unknown }, data: unknown) => ref.update(data),
      };
      return cb(tx);
    }),
  },
  COLLECTIONS: {
    USERS: "users",
    AUDIT_LOGS: "auditLogs",
    WEBHOOK_EVENTS: "webhookEvents",
  },
}));

// Import AFTER mocks
import { webhookEventsService } from "../webhook-events.service";

beforeEach(() => {
  vi.clearAllMocks();
  // `mockResolvedValueOnce` queued values SURVIVE clearAllMocks (only
  // call history is wiped). A test that throws before consuming its
  // stubbed findById leaks the value into the next test. Reset the
  // queues explicitly so each test runs with a clean mock stack.
  mockRepoFindById.mockReset();
  mockHandleWebhook.mockReset();
  mockHandleWebhook.mockResolvedValue(undefined);
  mockEventRefGet.mockReset();
  mockEventRefSet.mockReset();
  mockEventRefUpdate.mockReset();
  mockAuditRefSet.mockReset();
  mockRepoUpsert.mockResolvedValue(undefined);
  mockRepoUpdate.mockResolvedValue(undefined);
  mockRateLimit.mockResolvedValue({ allowed: true });
});

// ─── Receipt (record) ──────────────────────────────────────────────────────

describe("WebhookEventsService.record", () => {
  it("transactionally persists a fresh event with composite doc id, attempt=1, status=received", async () => {
    // record() runs read-then-write inside db.runTransaction so
    // concurrent provider retries converge (security review FAIL-1).
    // Tx.get returns exists:false → service calls tx.set with the
    // new row.
    txGetStub(false);

    const id = await webhookEventsService.record({
      provider: "wave",
      providerTransactionId: "tx-123",
      providerStatus: "succeeded",
      eventType: "payment.succeeded",
      rawBody: '{"tx":"tx-123"}',
      rawHeaders: { "X-Wave-Signature": "sig-abc", authorization: "secret" },
      metadata: { foo: "bar" },
    });

    expect(id).toBe("wave__tx-123__succeeded");
    expect(mockEventRefSet).toHaveBeenCalledTimes(1);
    const persisted = mockEventRefSet.mock.calls[0]?.[0];
    expect(persisted).toMatchObject({
      id: "wave__tx-123__succeeded",
      provider: "wave",
      providerTransactionId: "tx-123",
      providerStatus: "succeeded",
      processingStatus: "received",
      attempts: 1,
      paymentId: null,
      organizationId: null,
      lastError: null,
    });
    // Header allowlist — authorization MUST be stripped.
    expect(persisted.rawHeaders).toEqual({ "x-wave-signature": "sig-abc" });
    expect(persisted.rawHeaders.authorization).toBeUndefined();
    // No direct repo upsert — the write went through the transaction.
    expect(mockRepoUpsert).not.toHaveBeenCalled();
  });

  it("is idempotent on retry — same doc id, attempts++, firstReceivedAt untouched", async () => {
    // Provider retry — tx.get finds the existing row with attempts=1.
    txGetStub(true, {
      id: "wave__tx-123__succeeded",
      attempts: 1,
      firstReceivedAt: "2026-01-01T00:00:00.000Z",
      processingStatus: "processed",
    });

    const id = await webhookEventsService.record({
      provider: "wave",
      providerTransactionId: "tx-123",
      providerStatus: "succeeded",
      eventType: "payment.succeeded",
      rawBody: "retry body",
      rawHeaders: {},
      metadata: null,
    });

    expect(id).toBe("wave__tx-123__succeeded");
    // Retry path takes tx.update — no tx.set of a fresh row.
    expect(mockEventRefSet).not.toHaveBeenCalled();
    expect(mockEventRefUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: 2, lastAttemptedAt: expect.any(String) }),
    );
  });

  it("truncates oversized bodies with a visible marker", async () => {
    txGetStub(false);
    const huge = "x".repeat(100 * 1024); // 100 KB > 64 KB cap
    await webhookEventsService.record({
      provider: "wave",
      providerTransactionId: "tx-big",
      providerStatus: "succeeded",
      eventType: null,
      rawBody: huge,
      rawHeaders: {},
      metadata: null,
    });
    const persisted = mockEventRefSet.mock.calls[0]?.[0];
    expect(persisted.rawBody).toMatch(/\[truncated, original length 102400\]$/);
    expect(persisted.rawBody.length).toBeLessThanOrEqual(64 * 1024 + 80);
  });
});

// ─── markOutcome ──────────────────────────────────────────────────────────

describe("WebhookEventsService.markOutcome", () => {
  it("writes processed status with null error", async () => {
    await webhookEventsService.markOutcome({
      id: "wave__tx-123__succeeded",
      processingStatus: "processed",
    });
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      "wave__tx-123__succeeded",
      expect.objectContaining({ processingStatus: "processed", lastError: null }),
    );
  });

  it("writes failed status with error detail", async () => {
    await webhookEventsService.markOutcome({
      id: "wave__tx-123__succeeded",
      processingStatus: "failed",
      lastError: { code: "HANDLER_ERROR", message: "boom" },
    });
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      "wave__tx-123__succeeded",
      expect.objectContaining({
        processingStatus: "failed",
        lastError: { code: "HANDLER_ERROR", message: "boom" },
      }),
    );
  });
});

// ─── Admin list / get ──────────────────────────────────────────────────────

describe("WebhookEventsService.list + get", () => {
  it("rejects non-super_admin listings", async () => {
    const organizer = buildAuthUser({ roles: ["organizer"] });
    await expect(webhookEventsService.list(organizer, { page: 1, limit: 20 })).rejects.toThrow(
      /platform:manage/i,
    );
  });

  it("delegates to the repository for listing", async () => {
    const admin = buildSuperAdmin();
    mockRepoList.mockResolvedValueOnce({
      data: [{ id: "wave__tx-1__succeeded" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    const res = await webhookEventsService.list(admin, { page: 1, limit: 20 });
    expect(res.data).toHaveLength(1);
  });

  it("throws 404 when the get target doesn't exist", async () => {
    const admin = buildSuperAdmin();
    mockRepoFindById.mockResolvedValueOnce(null);
    await expect(webhookEventsService.get(admin, "ghost")).rejects.toMatchObject({
      code: "WEBHOOK_EVENT_NOT_FOUND",
      statusCode: 404,
    });
  });
});

// ─── Replay ───────────────────────────────────────────────────────────────

describe("WebhookEventsService.replay", () => {
  const admin = buildSuperAdmin();

  const STORED_EVENT = {
    id: "wave__tx-123__succeeded",
    provider: "wave",
    providerTransactionId: "tx-123",
    providerStatus: "succeeded" as const,
    eventType: "payment.succeeded",
    rawBody: "{}",
    rawHeaders: {},
    metadata: { currency: "XOF" },
    processingStatus: "failed" as const,
    attempts: 1,
    paymentId: null,
    organizationId: "org-001",
    firstReceivedAt: "2026-01-01T00:00:00.000Z",
    lastAttemptedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-04-01T00:00:00.000Z",
    lastError: { code: "HANDLER_ERROR", message: "prior failure" },
    requestId: "req-old",
  };

  function stubStoredEvent(overrides: Record<string, unknown> = {}) {
    // `replay` issues TWO findById calls — one pre-tx, one final
    // re-read after markOutcome. Inside the tx the service also
    // calls tx.get on the ref (hooked to mockEventRefGet).
    mockRepoFindById.mockResolvedValueOnce({ ...STORED_EVENT, ...overrides });
    // Tx.get returns the same "fresh" snapshot.
    txGetStub(true, { ...STORED_EVENT, ...overrides });
    // Final re-read returns the processed row.
    mockRepoFindById.mockResolvedValueOnce({
      ...STORED_EVENT,
      ...overrides,
      processingStatus: "processed",
      attempts: 2,
      lastError: null,
    });
  }

  it("re-invokes handleWebhook with stored payload, audits in-tx, emits, marks processed", async () => {
    stubStoredEvent();

    const final = await webhookEventsService.replay(admin, "wave__tx-123__succeeded");

    expect(final.processingStatus).toBe("processed");
    expect(mockHandleWebhook).toHaveBeenCalledWith("tx-123", "succeeded", { currency: "XOF" });
    // Attempt bump + audit row are written INSIDE the same
    // transaction (security review FAIL-2 fix). Each is a single
    // spy call — either both land or neither does.
    expect(mockEventRefUpdate).toHaveBeenCalledTimes(1);
    expect(mockEventRefUpdate.mock.calls[0]?.[0]).toMatchObject({ attempts: 2 });
    expect(mockAuditRefSet).toHaveBeenCalledTimes(1);
    expect(mockAuditRefSet.mock.calls[0]?.[0]).toMatchObject({
      action: "admin.webhook_replayed",
      resourceType: "webhook_event",
    });
    // Event bus emits AFTER the tx so a failed emit doesn't roll
    // back the attempt + audit pair.
    expect(mockBusEmit).toHaveBeenCalledWith(
      "admin.webhook_replayed",
      expect.objectContaining({
        webhookEventId: "wave__tx-123__succeeded",
        provider: "wave",
      }),
    );
    // markOutcome (post-handler) writes the terminal status via the
    // repository — not inside the transaction.
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      "wave__tx-123__succeeded",
      expect.objectContaining({ processingStatus: "processed" }),
    );
  });

  it("marks the event failed when the handler throws, audit row still landed in-tx", async () => {
    stubStoredEvent();
    mockHandleWebhook.mockRejectedValueOnce(new Error("handler boom"));

    await expect(webhookEventsService.replay(admin, "wave__tx-123__succeeded")).rejects.toThrow(
      /handler boom/,
    );

    // Audit + attempt bump landed — atomicity intact even on handler
    // failure.
    expect(mockAuditRefSet).toHaveBeenCalledTimes(1);
    expect(mockEventRefUpdate).toHaveBeenCalledTimes(1);
    // markOutcome(failed) still ran via the repository.
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      "wave__tx-123__succeeded",
      expect.objectContaining({
        processingStatus: "failed",
        lastError: expect.objectContaining({ message: expect.stringContaining("handler boom") }),
      }),
    );
  });

  it("sanitises phone-like strings in the error message before persisting", async () => {
    stubStoredEvent();
    // Emulate a handler throwing with a phone number in the message.
    mockHandleWebhook.mockRejectedValueOnce(
      new Error("Failed to reach customer +221 77 123 45 67 via SMS"),
    );

    await expect(webhookEventsService.replay(admin, "wave__tx-123__succeeded")).rejects.toThrow();

    const lastErrorWrite = mockRepoUpdate.mock.calls.find(
      (c) => c[1]?.processingStatus === "failed",
    );
    expect(lastErrorWrite?.[1].lastError.message).not.toMatch(/\+221\s?77/);
    expect(lastErrorWrite?.[1].lastError.message).toContain("[REDACTED_PHONE]");
  });

  it("rejects non-super_admin callers before any Firestore read or rate-limit tick", async () => {
    const organizer = buildAuthUser({ roles: ["organizer"] });
    await expect(webhookEventsService.replay(organizer, "wave__tx-123__succeeded")).rejects.toThrow(
      /platform:manage/i,
    );
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockRepoFindById).not.toHaveBeenCalled();
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  it("throws 404 when the event id doesn't match a stored row", async () => {
    mockRepoFindById.mockResolvedValueOnce(null);
    await expect(webhookEventsService.replay(admin, "ghost")).rejects.toThrow();
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  it("rejects when the per-admin replay quota is exhausted — NO Firestore read, no displayName lookup", async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSec: 30 });
    await expect(webhookEventsService.replay(admin, "wave__tx-123__succeeded")).rejects.toThrow(
      /Quota.*10\/min/i,
    );
    // Rate-limit-first ordering (security review FAIL-3) — denied
    // attempts leave zero trace.
    expect(mockRepoFindById).not.toHaveBeenCalled();
    expect(hoisted.mockUsersDocGet).not.toHaveBeenCalled();
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });
});
