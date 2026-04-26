import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 3 — `onPaymentReconciliation` cron trigger tests.
 *
 * The trigger is a thin proxy: read env, build URL, POST with the
 * shared secret, log the response. No Firestore reads, no provider
 * calls — the API endpoint owns the actual sweep. We verify the
 * proxy contract (correct URL shape, correct header, correct timeout
 * semantics, correct fail-soft behaviour when env is missing).
 */

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("firebase-functions/v2", () => ({
  logger: mockLogger,
}));

// `payment.triggers.ts` imports `db, messaging, COLLECTIONS` from utils/admin
// for its other handlers (onPaymentTimeout / onPaymentSucceeded). We mock
// the module surface but don't exercise it from this test.
vi.mock("../../utils/admin", () => ({
  db: { collection: vi.fn() },
  messaging: { sendEachForMulticast: vi.fn() },
  COLLECTIONS: {
    PAYMENTS: "payments",
    REGISTRATIONS: "registrations",
    AUDIT_LOGS: "auditLogs",
    EVENTS: "events",
    USERS: "users",
    BADGES: "badges",
    NOTIFICATIONS: "notifications",
  },
}));

import { onPaymentReconciliation } from "../payment.triggers";

const handler = onPaymentReconciliation as unknown as () => Promise<void>;

const ORIG_API_URL = process.env.API_BASE_URL;
const ORIG_SECRET = process.env.INTERNAL_DISPATCH_SECRET;
const ORIG_FETCH = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_BASE_URL = "https://api.staging.example/";
  process.env.INTERNAL_DISPATCH_SECRET = "test-shared-secret-128bit-padding";
});

afterEach(() => {
  process.env.API_BASE_URL = ORIG_API_URL;
  process.env.INTERNAL_DISPATCH_SECRET = ORIG_SECRET;
  global.fetch = ORIG_FETCH;
});

describe("onPaymentReconciliation — cron trigger", () => {
  it("POSTs to /v1/internal/payments/reconcile with the shared secret + JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          data: { scanned: 5, finalizedSucceeded: 2, finalizedFailed: 1, stillPending: 2, errored: 0 },
        }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await handler();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // Trailing slash on API_BASE_URL is normalised
    expect(url).toBe("https://api.staging.example/v1/internal/payments/reconcile");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit & { headers: Record<string, string> }).headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Dispatch-Secret": "test-shared-secret-128bit-padding",
    });
    // Empty body lets the API use its configured defaults.
    expect((init as RequestInit).body).toBe("{}");
    // Sweep stats are logged at info
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("payment.reconciliation"),
      expect.objectContaining({
        stats: expect.objectContaining({ scanned: 5, finalizedSucceeded: 2 }),
      }),
    );
  });

  it("warns + returns silently when API_BASE_URL is unset (un-provisioned env)", async () => {
    delete process.env.API_BASE_URL;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await handler();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("warns + returns silently when INTERNAL_DISPATCH_SECRET is unset", async () => {
    delete process.env.INTERNAL_DISPATCH_SECRET;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await handler();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("logs error when the API returns non-2xx (does not throw)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await handler();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("non-2xx"),
      expect.objectContaining({ status: 500 }),
    );
  });

  it("logs an AbortError when fetch is aborted (cron-tick 90 s timeout)", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await handler();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("timed out"),
    );
  });

  it("logs an unknown error category for non-AbortError network failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    global.fetch = fetchMock as unknown as typeof fetch;

    await handler();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("API call failed"),
      expect.objectContaining({ err: "ECONNREFUSED" }),
    );
  });
});
