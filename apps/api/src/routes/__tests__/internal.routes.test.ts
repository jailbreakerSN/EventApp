import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

// ─── Internal dispatch route tests ─────────────────────────────────────────

const mockDispatch = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/notification-dispatcher.service", () => ({
  notificationDispatcher: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
  },
}));

// Stable secret for tests — must match what the route reads from `config`.
// Hoisted via vi.hoisted so the vi.mock factory can reference it.
const { TEST_SECRET } = vi.hoisted(() => ({
  TEST_SECRET: "test-internal-dispatch-secret-value-0123456789ab",
}));

vi.mock("@/config", async () => {
  const actual = await vi.importActual<typeof import("@/config")>("@/config");
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
