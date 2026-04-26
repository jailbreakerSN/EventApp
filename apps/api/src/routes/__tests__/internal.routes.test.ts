import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
// Import the real module solely so we can use `typeof configModule` below.
// A plain `await vi.importActual<typeof import("@/config")>(...)` triggers
// the @typescript-eslint/consistent-type-imports rule — a static import
// gives the same type information without the dynamic-import annotation.
import type * as configModule from "@/config";

// ─── Internal dispatch route tests ─────────────────────────────────────────

const mockDispatch = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/notification-dispatcher.service", () => ({
  notificationDispatcher: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
  },
}));

// Phase 3 — reconciliation surface mock. Lazy-imported by the route
// at handler time, so the mock only needs to exist when `paymentService`
// is dynamically required.
const mockReconcile = vi.fn().mockResolvedValue({
  scanned: 7,
  finalizedSucceeded: 3,
  finalizedFailed: 1,
  stillPending: 2,
  errored: 1,
});
vi.mock("@/services/payment.service", () => ({
  paymentService: {
    reconcileStuckPayments: (...args: unknown[]) => mockReconcile(...args),
  },
}));

// Phase Finance — balance release sweep mock. Same lazy-import pattern.
const mockReleaseAvailableFunds = vi.fn().mockResolvedValue({
  released: 4,
  organizationsAudited: 2,
  asOf: "2026-04-26T12:00:00.000Z",
});
vi.mock("@/services/balance.service", () => ({
  balanceService: {
    releaseAvailableFunds: (...args: unknown[]) => mockReleaseAvailableFunds(...args),
  },
}));

// Stable secret for tests — must match what the route reads from `config`.
// Hoisted via vi.hoisted so the vi.mock factory can reference it.
const { TEST_SECRET } = vi.hoisted(() => ({
  TEST_SECRET: "test-internal-dispatch-secret-value-0123456789ab",
}));

vi.mock("@/config", async () => {
  const actual = (await vi.importActual("@/config")) as typeof configModule;
  return {
    ...actual,
    config: { ...actual.config, INTERNAL_DISPATCH_SECRET: TEST_SECRET },
  };
});

import { internalRoutes } from "../internal.routes";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(internalRoutes, { prefix: "/v1/internal" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockDispatch.mockClear();
  mockReconcile.mockClear();
  mockReleaseAvailableFunds.mockClear();
});

describe("POST /v1/internal/notifications/dispatch", () => {
  it("returns 404 when the secret is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/notifications/dispatch",
      payload: {
        key: "event.reminder",
        recipients: [{ userId: "u-1", preferredLocale: "fr" }],
        params: {},
      },
    });
    expect(res.statusCode).toBe(404);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns 404 when the secret is wrong", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/notifications/dispatch",
      headers: { "X-Internal-Dispatch-Secret": "wrong-secret" },
      payload: {
        key: "event.reminder",
        recipients: [{ userId: "u-1", preferredLocale: "fr" }],
        params: {},
      },
    });
    expect(res.statusCode).toBe(404);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("rejects unknown notification keys at the validation layer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/notifications/dispatch",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: {
        key: "nonexistent.key",
        recipients: [{ userId: "u-1", preferredLocale: "fr" }],
        params: {},
      },
    });
    expect(res.statusCode).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("dispatches when the secret matches and the key is known", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/notifications/dispatch",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: {
        key: "event.reminder",
        recipients: [{ userId: "u-1", email: "u@test.com", preferredLocale: "fr" }],
        params: { eventTitle: "Summit" },
        idempotencyKey: "event_reminder_24h_ev-1",
      },
    });
    expect(res.statusCode).toBe(202);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const arg = mockDispatch.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.key).toBe("event.reminder");
    const recipients = arg.recipients as Array<Record<string, unknown>>;
    expect(recipients).toHaveLength(1);
    expect(recipients[0]!.userId).toBe("u-1");
    expect(recipients[0]!.email).toBe("u@test.com");
    expect(arg.idempotencyKey).toBe("event_reminder_24h_ev-1");
  });

  it("rejects oversized recipient batches (> 500)", async () => {
    const recipients = Array.from({ length: 501 }, (_, i) => ({
      userId: `u-${i}`,
      preferredLocale: "fr" as const,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/notifications/dispatch",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: { key: "event.reminder", recipients, params: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ─── Phase 3 — POST /v1/internal/payments/reconcile ────────────────────────

describe("POST /v1/internal/payments/reconcile", () => {
  it("returns 404 when the secret header is missing (probe-invisible surface)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/payments/reconcile",
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("returns 404 when the secret is wrong", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/payments/reconcile",
      headers: { "X-Internal-Dispatch-Secret": "nope" },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("returns 200 + sweep stats when the secret matches", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/payments/reconcile",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      scanned: 7,
      finalizedSucceeded: 3,
      finalizedFailed: 1,
      stillPending: 2,
      errored: 1,
    });
    // Empty body → service called with empty options (defaults apply)
    expect(mockReconcile).toHaveBeenCalledWith({});
  });

  it("forwards window + batchSize overrides to the service when provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/payments/reconcile",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: { windowMinMs: 60_000, windowMaxMs: 1_800_000, batchSize: 100 },
    });
    expect(res.statusCode).toBe(200);
    expect(mockReconcile).toHaveBeenCalledWith({
      windowMinMs: 60_000,
      windowMaxMs: 1_800_000,
      batchSize: 100,
    });
  });

  it("rejects out-of-bound batchSize at the validation layer (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/payments/reconcile",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: { batchSize: 99999 },
    });
    expect(res.statusCode).toBe(400);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  // FAIL-1 fix — secret guard now runs BEFORE the Zod body validator.
  // An unauthenticated probe with a malformed body MUST see 404 (same
  // as a probe with a valid body), not 400 — otherwise the response-
  // code difference reveals the endpoint exists.
  it("returns 404 (not 400) when the secret is wrong AND the body is invalid (no oracle leak)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/payments/reconcile",
      headers: { "X-Internal-Dispatch-Secret": "wrong" },
      payload: { batchSize: "not-a-number" },
    });
    expect(res.statusCode).toBe(404);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  // FAIL-3 fix — cross-field refine ensures windowMinMs < windowMaxMs.
  it("rejects windowMinMs >= windowMaxMs at the validation layer (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/payments/reconcile",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: { windowMinMs: 60_000 * 30, windowMaxMs: 60_000 * 10 },
    });
    expect(res.statusCode).toBe(400);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  // FAIL-3 fix — windowMinMs has a 1-minute floor so a stolen secret
  // can't bypass the operational "give the IPN a chance" intent.
  it("rejects windowMinMs below the 60s floor (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/payments/reconcile",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: { windowMinMs: 1, windowMaxMs: 3_600_000 },
    });
    expect(res.statusCode).toBe(400);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  // Body strictness — extra unknown keys must be rejected. Kept in lock-
  // step with the equivalent guard on the admin handler's input schema.
  it("rejects unknown body keys (400) — `.strict()` posture", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/payments/reconcile",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: { batchSize: 50, unknownExtraKey: "should-fail" },
    });
    expect(res.statusCode).toBe(400);
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});

// ─── Phase Finance — POST /v1/internal/balance/release-available ──────────
//
// Cron-fired endpoint that the hourly `releaseAvailableFunds` Cloud Function
// hits. Same posture as `/payments/reconcile`: secret guard FIRST,
// fail-closed-404, body validation, then delegate to the service. These
// tests are the route-level coverage that the test-coverage reviewer
// flagged P0-missing — the handler unit tests cover the sweep logic but
// don't exercise this route's secret guard, body validator, or
// oracle-leak guard.

describe("POST /v1/internal/balance/release-available", () => {
  it("returns 404 when the secret is missing (no service call)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/balance/release-available",
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(mockReleaseAvailableFunds).not.toHaveBeenCalled();
  });

  it("returns 404 when the secret is wrong (constant-time mismatch)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/balance/release-available",
      headers: { "X-Internal-Dispatch-Secret": "wrong-secret" },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(mockReleaseAvailableFunds).not.toHaveBeenCalled();
  });

  // Oracle-leak guard — without secret-first, an unauth probe with a
  // malformed body would land 400 (vs 404 for a syntactically valid
  // body), letting an attacker confirm the endpoint exists.
  it("returns 404 (NOT 400) when secret is wrong AND body is malformed (oracle-leak guard)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/balance/release-available",
      headers: { "X-Internal-Dispatch-Secret": "wrong-secret" },
      // `asOf` must be ISO datetime — this would normally trigger 400,
      // but the secret guard runs FIRST so we get 404.
      payload: { asOf: "not-a-date" },
    });
    expect(res.statusCode).toBe(404);
    expect(mockReleaseAvailableFunds).not.toHaveBeenCalled();
  });

  it("delegates to balanceService.releaseAvailableFunds and returns 200 with the result", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/balance/release-available",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(mockReleaseAvailableFunds).toHaveBeenCalledTimes(1);
    const arg = mockReleaseAvailableFunds.mock.calls[0]![0] as Record<string, unknown>;
    // Cron path tags its runId with `system:cron-<uuid>` so audit
    // consumers can tell scheduled runs apart from manual runs.
    expect(typeof arg.runId).toBe("string");
    expect(arg.runId).toMatch(
      /^system:cron-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // Cron default cap (5_000) is below the service's hard ceiling
    // (50_000). Operators on /admin/jobs can raise it explicitly.
    expect(arg.maxEntries).toBe(5_000);

    const body = res.json() as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ released: 4, organizationsAudited: 2 });
  });

  it("forwards explicit asOf + maxEntries to the service when supplied", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/balance/release-available",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: {
        asOf: new Date(Date.now() - 60_000).toISOString(),
        maxEntries: 1_000,
      },
    });
    expect(res.statusCode).toBe(200);
    const arg = mockReleaseAvailableFunds.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.maxEntries).toBe(1_000);
    expect(typeof arg.asOf).toBe("string");
  });

  it("rejects an asOf more than 5 minutes in the future (400) — operator-typo guard", async () => {
    const farFuture = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/balance/release-available",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: { asOf: farFuture },
    });
    expect(res.statusCode).toBe(400);
    expect(mockReleaseAvailableFunds).not.toHaveBeenCalled();
  });

  it("rejects asOf that is not a datetime string (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/balance/release-available",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: { asOf: "not-a-date" },
    });
    expect(res.statusCode).toBe(400);
    expect(mockReleaseAvailableFunds).not.toHaveBeenCalled();
  });

  it("rejects maxEntries above the 50_000 cap (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/balance/release-available",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: { maxEntries: 50_001 },
    });
    expect(res.statusCode).toBe(400);
    expect(mockReleaseAvailableFunds).not.toHaveBeenCalled();
  });

  it("rejects unknown body keys (400) — `.strict()` posture", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/balance/release-available",
      headers: { "X-Internal-Dispatch-Secret": TEST_SECRET },
      payload: { foo: "bar" },
    });
    expect(res.statusCode).toBe(400);
    expect(mockReleaseAvailableFunds).not.toHaveBeenCalled();
  });
});
