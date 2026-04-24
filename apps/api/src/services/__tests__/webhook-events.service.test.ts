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
  mockAuditAdd: vi.fn().mockResolvedValue({ id: "audit-row" }),
  mockRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  mockBusEmit: vi.fn(),
  mockUsersDocGet: vi.fn().mockResolvedValue({ exists: false }),
}));

const {
  mockRepoFindById,
  mockRepoUpsert,
  mockRepoUpdate,
  mockRepoList,
  mockHandleWebhook,
  mockAuditAdd,
  mockRateLimit,
  mockBusEmit,
} = hoisted;

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
      doc: vi.fn(() => ({
        get: name === "users" ? hoisted.mockUsersDocGet : vi.fn(),
      })),
      add: name === "auditLogs" ? hoisted.mockAuditAdd : vi.fn(),
    })),
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
  mockRepoUpsert.mockResolvedValue(undefined);
  mockRepoUpdate.mockResolvedValue(undefined);
  mockRateLimit.mockResolvedValue({ allowed: true });
});

// ─── Receipt (record) ──────────────────────────────────────────────────────

describe("WebhookEventsService.record", () => {
  it("persists a fresh event with composite doc id, attempt=1, status=received", async () => {
    mockRepoFindById.mockResolvedValueOnce(null);

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
    expect(mockRepoUpsert).toHaveBeenCalledTimes(1);
    const persisted = mockRepoUpsert.mock.calls[0]?.[0];
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
  });

  it("is idempotent on retry — same doc id, attempts++, firstReceivedAt untouched", async () => {
    // Simulate a retry from the provider: row exists with attempts=1.
    mockRepoFindById.mockResolvedValueOnce({
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
    // No upsert on retry — just an update of attempts + lastAttemptedAt.
    expect(mockRepoUpsert).not.toHaveBeenCalled();
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      "wave__tx-123__succeeded",
      expect.objectContaining({ attempts: 2, lastAttemptedAt: expect.any(String) }),
    );
  });

  it("truncates oversized bodies with a visible marker", async () => {
    mockRepoFindById.mockResolvedValueOnce(null);
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
    const persisted = mockRepoUpsert.mock.calls[0]?.[0];
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

  function stubStoredEvent(overrides: Record<string, unknown> = {}) {
    const base = {
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
      lastError: { code: "HANDLER_ERROR", message: "prior failure" },
      requestId: "req-old",
    };
    // First findById (inside replay) returns the stored event; second
    // findById (final re-read) returns the updated terminal shape.
    mockRepoFindById.mockResolvedValueOnce({ ...base, ...overrides });
    mockRepoFindById.mockResolvedValueOnce({
      ...base,
      ...overrides,
      processingStatus: "processed",
      attempts: 2,
      lastError: null,
    });
  }

  it("re-invokes handleWebhook with stored payload, audits, emits, marks processed", async () => {
    stubStoredEvent();

    const final = await webhookEventsService.replay(
      admin,
      "wave__tx-123__succeeded",
      "Admin Tester",
    );

    expect(final.processingStatus).toBe("processed");
    expect(mockHandleWebhook).toHaveBeenCalledWith("tx-123", "succeeded", { currency: "XOF" });
    // Event emission + audit fire BEFORE the handler work.
    expect(mockBusEmit).toHaveBeenCalledWith(
      "admin.webhook_replayed",
      expect.objectContaining({
        webhookEventId: "wave__tx-123__succeeded",
        provider: "wave",
      }),
    );
    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.webhook_replayed" }),
    );
    // Update sequence: bump attempts/requestId BEFORE handler, then
    // markOutcome(processed) AFTER.
    expect(mockRepoUpdate).toHaveBeenCalledTimes(2);
    expect(mockRepoUpdate.mock.calls[0]?.[1]).toMatchObject({ attempts: 2 });
    expect(mockRepoUpdate.mock.calls[1]?.[1]).toMatchObject({ processingStatus: "processed" });
  });

  it("marks the event failed when the handler throws, but still audits + emits", async () => {
    stubStoredEvent();
    mockHandleWebhook.mockRejectedValueOnce(new Error("handler boom"));

    await expect(
      webhookEventsService.replay(admin, "wave__tx-123__succeeded", null),
    ).rejects.toThrow(/handler boom/);

    expect(mockAuditAdd).toHaveBeenCalledTimes(1);
    expect(mockBusEmit).toHaveBeenCalledTimes(1);
    // Second update writes failed + error detail.
    expect(mockRepoUpdate).toHaveBeenCalledTimes(2);
    expect(mockRepoUpdate.mock.calls[1]?.[1]).toMatchObject({
      processingStatus: "failed",
      lastError: expect.objectContaining({ message: expect.stringContaining("handler boom") }),
    });
  });

  it("rejects non-super_admin callers before any work", async () => {
    const organizer = buildAuthUser({ roles: ["organizer"] });
    await expect(
      webhookEventsService.replay(organizer, "wave__tx-123__succeeded", null),
    ).rejects.toThrow(/platform:manage/i);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockRepoFindById).not.toHaveBeenCalled();
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  it("throws 404 when the event id doesn't match a stored row", async () => {
    mockRepoFindById.mockResolvedValueOnce(null);
    await expect(webhookEventsService.replay(admin, "ghost", null)).rejects.toThrow();
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  it("rejects when the per-admin replay quota is exhausted", async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSec: 30 });
    await expect(
      webhookEventsService.replay(admin, "wave__tx-123__succeeded", null),
    ).rejects.toThrow(/Quota.*10\/min/i);
    expect(mockRepoFindById).not.toHaveBeenCalled();
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });
});
