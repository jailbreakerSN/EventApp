import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { AppError } from "@/errors/app-error";

// ─── Payouts route — P1-22 (audit L4) ──────────────────────────────────────
//
// Pinned scope: the `GET /v1/payouts/event/:eventId/calculate` query
// surface. The previous shape accepted any string in periodFrom /
// periodTo — bypass-the-validator inputs reached the service layer
// where Firestore range filters silently treated them as a different
// value space than the stored ISO timestamps. Switching to
// `IsoDateTimeSchema` (z.string().datetime()) rejects malformed
// timestamps with a clean 400 before any service / Firestore work.
//
// This file pins ONLY the schema contract; service-level semantics
// (organization access, math) live in `payout.service.test.ts`.

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
}));

vi.mock("@/config", () => ({
  config: {
    NODE_ENV: "development",
    CORS_ORIGINS: ["http://localhost:3001"],
    APP_ORIGIN: "http://localhost:3001",
  },
}));

const mockPayoutService = {
  calculatePayout: vi.fn(),
  createPayout: vi.fn(),
  getOrgPayouts: vi.fn(),
  markPaid: vi.fn(),
  getPayout: vi.fn(),
};

vi.mock("@/services/payout.service", () => ({
  payoutService: new Proxy(
    {},
    {
      get: (_t, p) => (mockPayoutService as Record<string, unknown>)[p as string],
    },
  ),
}));

let app: FastifyInstance;

beforeAll(async () => {
  // Lazy-import the route plugin so the vi.mock() factories above
  // are wired in before the plugin's module-level imports resolve.
  const { payoutRoutes } = await import("../payouts.routes");
  app = Fastify({ logger: false });
  await app.register(payoutRoutes, { prefix: "/v1/payouts" });
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: { code: error.code, message: error.message },
      });
    }
    return reply.status(error.statusCode ?? 500).send({
      success: false,
      error: { code: "ERROR", message: error.message },
    });
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({
    uid: "org-admin-1",
    email: "org@example.com",
    email_verified: true,
    roles: ["organizer"],
    organizationId: "org-1",
  });
});

const authHeader = { authorization: "Bearer mock-token" };

describe("GET /v1/payouts/event/:eventId/calculate (P1-22)", () => {
  it("400 when periodFrom is malformed (not ISO 8601)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/payouts/event/evt-1/calculate?periodFrom=2026-13-99&periodTo=2026-04-30T00:00:00.000Z",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
    expect(mockPayoutService.calculatePayout).not.toHaveBeenCalled();
  });

  it("400 when periodTo is malformed (date-only, no time)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/payouts/event/evt-1/calculate?periodFrom=2026-04-01T00:00:00.000Z&periodTo=2026-04-30",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
    expect(mockPayoutService.calculatePayout).not.toHaveBeenCalled();
  });

  it("400 when periodFrom is empty", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/payouts/event/evt-1/calculate?periodFrom=&periodTo=2026-04-30T00:00:00.000Z",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
    expect(mockPayoutService.calculatePayout).not.toHaveBeenCalled();
  });

  it("400 when both periods are arbitrary strings (the original L4 footgun)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/payouts/event/evt-1/calculate?periodFrom=yesterday&periodTo=tomorrow",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
    expect(mockPayoutService.calculatePayout).not.toHaveBeenCalled();
  });

  it("forwards a well-formed ISO 8601 pair to the service", async () => {
    mockPayoutService.calculatePayout.mockResolvedValue({
      grossAmount: 0,
      netAmount: 0,
      platformFee: 0,
      paymentCount: 0,
      payments: [],
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/payouts/event/evt-1/calculate?periodFrom=2026-04-01T00:00:00.000Z&periodTo=2026-04-30T23:59:59.000Z",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(mockPayoutService.calculatePayout).toHaveBeenCalledWith(
      "evt-1",
      "2026-04-01T00:00:00.000Z",
      "2026-04-30T23:59:59.000Z",
      expect.objectContaining({ uid: "org-admin-1" }),
    );
  });

  it("401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/payouts/event/evt-1/calculate?periodFrom=2026-04-01T00:00:00.000Z&periodTo=2026-04-30T23:59:59.000Z",
    });
    expect(res.statusCode).toBe(401);
    expect(mockPayoutService.calculatePayout).not.toHaveBeenCalled();
  });
});
