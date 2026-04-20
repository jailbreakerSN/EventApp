import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { paymentRoutes } from "../payments.routes";
import { AppError } from "@/errors/app-error";

// ─── Payments route coverage ───────────────────────────────────────────────
// Money flows through here. Every auth gap or signature-verification
// regression has a direct monetary impact, so the route-level
// invariants MUST stay pinned:
//
//   - `POST /initiate` needs auth + email-verified + `payment:initiate`
//   - `POST /webhook/:provider` MUST be unauthenticated (providers
//     don't have our Firebase token) but MUST verify the provider's
//     signature before calling `paymentService.handleWebhook`.
//   - Refund endpoint needs `payment:refund` (organizer-tier).
//
// Service semantics (provider integration, refund arithmetic, rawBody
// capture) live in `services/__tests__/payment.service.test.ts`. This
// file asserts the wiring.

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
}));

// The config module is imported at the route plugin's top — fake
// development mode so the dev-only mock-checkout branch still loads
// without crashing (its registration runs conditionally, and we
// don't test it from here).
vi.mock("@/config", () => ({
  config: {
    NODE_ENV: "development",
    CORS_ORIGINS: ["http://localhost:3001"],
    APP_ORIGIN: "http://localhost:3001",
  },
}));

const mockPaymentService = {
  initiatePayment: vi.fn(),
  handleWebhook: vi.fn(),
  getPaymentStatus: vi.fn(),
  refundPayment: vi.fn(),
  getMyPayments: vi.fn(),
  getEventPayments: vi.fn(),
};

const mockProvider = {
  name: "mock",
  verifyWebhook: vi.fn(),
};

vi.mock("@/services/payment.service", () => ({
  paymentService: new Proxy(
    {},
    {
      get: (_t, p) => (mockPaymentService as Record<string, unknown>)[p as string],
    },
  ),
  signWebhookPayload: vi.fn(() => "sig-mock"),
  getProviderForWebhook: () => mockProvider,
}));

vi.mock("@/providers/mock-payment.provider", () => ({
  MockPaymentProvider: class {
    name = "mock";
    verifyWebhook() {
      return true;
    }
  },
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(paymentRoutes, { prefix: "/v1/payments" });
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
    uid: "participant-1",
    email: "buyer@example.com",
    email_verified: true,
    roles: ["participant"],
  });
  mockProvider.verifyWebhook.mockReturnValue(true);
});

const authHeader = { authorization: "Bearer mock-token" };

describe("POST /v1/payments/initiate", () => {
  it("401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/initiate",
      payload: {
        eventId: "evt-1",
        ticketTypeId: "t1",
        method: "mock",
        returnUrl: "http://localhost:3002/return",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(mockPaymentService.initiatePayment).not.toHaveBeenCalled();
  });

  it("403 when email is not verified", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "participant-1",
      email: "buyer@example.com",
      email_verified: false,
      roles: ["participant"],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/initiate",
      headers: authHeader,
      payload: {
        eventId: "evt-1",
        ticketTypeId: "t1",
        method: "mock",
        returnUrl: "http://localhost:3002/return",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(mockPaymentService.initiatePayment).not.toHaveBeenCalled();
  });

  it("400 when body fails validation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/initiate",
      headers: authHeader,
      payload: { eventId: "evt-1" }, // missing ticketTypeId + method + returnUrl
    });
    expect(res.statusCode).toBe(400);
    expect(mockPaymentService.initiatePayment).not.toHaveBeenCalled();
  });

  it("201 forwards sanitised args to the service", async () => {
    mockPaymentService.initiatePayment.mockResolvedValue({
      paymentId: "pay-1",
      redirectUrl: "http://provider/checkout",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/initiate",
      headers: authHeader,
      payload: {
        eventId: "evt-1",
        ticketTypeId: "t1",
        method: "mock",
        returnUrl: "http://localhost:3002/return",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(mockPaymentService.initiatePayment).toHaveBeenCalledWith(
      "evt-1",
      "t1",
      "mock",
      "http://localhost:3002/return",
      expect.objectContaining({ uid: "participant-1" }),
    );
  });
});

describe("POST /v1/payments/webhook/:provider", () => {
  it("does NOT require auth (providers don't carry a Firebase token)", async () => {
    mockPaymentService.handleWebhook.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/mock",
      // no authorization header
      payload: {
        providerTransactionId: "tx-1",
        status: "succeeded",
      },
    });
    expect([200, 202]).toContain(res.statusCode);
    expect(mockPaymentService.handleWebhook).toHaveBeenCalled();
  });

  it("403 when provider signature verification fails", async () => {
    mockProvider.verifyWebhook.mockReturnValueOnce(false);

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/mock",
      payload: {
        providerTransactionId: "tx-1",
        status: "succeeded",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(mockPaymentService.handleWebhook).not.toHaveBeenCalled();
  });

  it("400 when body fails validation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/mock",
      payload: { providerTransactionId: "tx-1" }, // missing status
    });
    expect(res.statusCode).toBe(400);
    expect(mockPaymentService.handleWebhook).not.toHaveBeenCalled();
  });
});

describe("POST /v1/payments/:paymentId/refund", () => {
  it("401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/pay-1/refund",
      payload: { amount: 5000, reason: "duplicate" },
    });
    expect(res.statusCode).toBe(401);
    expect(mockPaymentService.refundPayment).not.toHaveBeenCalled();
  });

  it("403 as participant (missing payment:refund)", async () => {
    // Default beforeEach auth is participant. Refund needs organizer tier.
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/pay-1/refund",
      headers: authHeader,
      payload: { amount: 5000, reason: "duplicate" },
    });
    expect(res.statusCode).toBe(403);
    expect(mockPaymentService.refundPayment).not.toHaveBeenCalled();
  });

  it("200 as organizer refunds payment", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "org-admin-1",
      email: "org@example.com",
      email_verified: true,
      roles: ["organizer"],
      organizationId: "org-1",
    });
    mockPaymentService.refundPayment.mockResolvedValue({
      id: "pay-1",
      status: "refunded",
      refundedAmount: 5000,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/pay-1/refund",
      headers: authHeader,
      payload: { amount: 5000, reason: "duplicate" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPaymentService.refundPayment).toHaveBeenCalledWith(
      "pay-1",
      5000,
      "duplicate",
      expect.objectContaining({ roles: ["organizer"] }),
    );
  });
});
