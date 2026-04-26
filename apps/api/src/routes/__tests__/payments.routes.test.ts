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
  resumePayment: vi.fn(),
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

vi.mock("@/providers/mock-payment.provider", () => {
  // P1-16 — mock-checkout /complete route tests need the static
  // `simulateCallback` to be controllable per-test. We expose a vi.fn
  // so tests can pin the return value and assert it was (or was NOT)
  // called depending on whether Zod accepted the body.
  const simulateCallback = vi.fn();
  return {
    MockPaymentProvider: class {
      name = "mock";
      verifyWebhook() {
        return true;
      }
      static simulateCallback = simulateCallback;
      static getState = vi.fn();
    },
    __mockSimulateCallback: simulateCallback,
  };
});

// T2.1 — webhook events log + replay service. Payment webhook route
// now calls `.record()` before handling + `.markOutcome()` after. We
// mock both so the existing route test exercises only the payments
// surface; the webhook-events service has its own dedicated test file.
vi.mock("@/services/webhook-events.service", () => ({
  webhookEventsService: {
    record: vi.fn().mockResolvedValue("wave__mock-tx__succeeded"),
    markOutcome: vi.fn().mockResolvedValue(undefined),
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
    // Service signature, post-P1-06: (eventId, ticketTypeId, method,
    // returnUrl, user, opts). The route reads `Idempotency-Key` from
    // headers and threads it through the `opts` bag — `undefined`
    // here because this test doesn't set the header (the synthetic
    // fingerprint takes over server-side).
    expect(mockPaymentService.initiatePayment).toHaveBeenCalledWith(
      "evt-1",
      "t1",
      "mock",
      "http://localhost:3002/return",
      expect.objectContaining({ uid: "participant-1" }),
      expect.objectContaining({ idempotencyKey: undefined }),
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

  // ── Phase 2 — PayDunya IPN (form-encoded body parser) ───────────────────
  //
  // PayDunya posts the IPN as `application/x-www-form-urlencoded` with
  // a single field `data` whose value is a JSON-stringified payload.
  // The body parser captures the raw body for signature verification
  // AND projects the payload onto the canonical PaymentWebhookSchema
  // shape so downstream handlers stay provider-agnostic. Anti-tampering
  // invariants (expectedAmount + expectedPaymentId) are surfaced on
  // metadata for handleWebhook to verify before any state mutation.

  it("accepts PayDunya IPN as application/x-www-form-urlencoded — Phase 2", async () => {
    mockPaymentService.handleWebhook.mockResolvedValue(undefined);
    mockProvider.verifyWebhook.mockReturnValue(true);

    const payload = {
      response_code: "00",
      response_text: "Paiement reçu",
      hash: "any-hash-the-mock-accepts",
      invoice: { token: "PAYDUNYA_TKN", total_amount: 5000, description: "" },
      custom_data: { payment_id: "pay_paydunya_1" },
      status: "completed",
    };
    const formBody = `data=${encodeURIComponent(JSON.stringify(payload))}`;

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: formBody,
    });

    expect(res.statusCode).toBe(200);
    // The handler received the canonical shape — the body parser
    // projected PayDunya `invoice.token` → providerTransactionId,
    // `status: "completed"` → "succeeded", and surfaced the
    // anti-tampering fields on metadata.
    expect(mockPaymentService.handleWebhook).toHaveBeenCalledWith(
      "PAYDUNYA_TKN",
      "succeeded",
      expect.objectContaining({
        providerName: "paydunya",
        expectedAmount: 5000,
        expectedPaymentId: "pay_paydunya_1",
      }),
    );
  });

  it("maps PayDunya `cancelled` / `failed` to `failed`", async () => {
    mockPaymentService.handleWebhook.mockResolvedValue(undefined);
    mockProvider.verifyWebhook.mockReturnValue(true);

    for (const status of ["cancelled", "failed"]) {
      const payload = {
        response_code: "00",
        invoice: { token: "TKN" },
        custom_data: { payment_id: "pay_x" },
        status,
      };
      const formBody = `data=${encodeURIComponent(JSON.stringify(payload))}`;
      const res = await app.inject({
        method: "POST",
        url: "/v1/payments/webhook/paydunya",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: formBody,
      });
      expect(res.statusCode).toBe(200);
      const lastCall = mockPaymentService.handleWebhook.mock.calls.at(-1);
      expect(lastCall?.[1]).toBe("failed");
    }
  });

  it("rejects PayDunya IPN with 403 when verifyWebhook returns false", async () => {
    mockProvider.verifyWebhook.mockReturnValueOnce(false);

    const payload = {
      hash: "wrong-hash",
      invoice: { token: "TKN" },
      custom_data: { payment_id: "pay_x" },
      status: "completed",
    };
    const formBody = `data=${encodeURIComponent(JSON.stringify(payload))}`;

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: formBody,
    });
    expect(res.statusCode).toBe(403);
    expect(mockPaymentService.handleWebhook).not.toHaveBeenCalled();
  });

  it("does NOT accept x-www-form-urlencoded outside the webhook path scope", async () => {
    // Defensive: the form-body parser is scoped to `/webhook/*`. A
    // non-webhook route receiving form-encoded must NOT have it
    // silently parsed by our PayDunya parser. Fastify falls through
    // to its default content-type handling → 415 / 400 depending on
    // the route. Here the /initiate route requires JSON, so a form
    // body lands as 415 (Unsupported Media Type) via the global
    // hook in app.ts.
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/initiate",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: "Bearer mock-token",
      },
      payload: "data=anything",
    });
    // Fastify's content-type-parser scope kicks in here; our parser
    // is only registered for the payment-routes prefix and explicitly
    // rejects non-webhook URLs. The exact status depends on which
    // hook fires first (415 from the global mutation guard, or the
    // parser's own error). Either way it must NOT reach the service.
    expect([400, 415]).toContain(res.statusCode);
    expect(mockPaymentService.initiatePayment).not.toHaveBeenCalled();
  });

  it("handles a PayDunya IPN with a missing custom_data.payment_id (defensive)", async () => {
    // PayDunya should always send payment_id (we set it at initiate
    // time), but defend against malformed payloads anyway.
    // expectedPaymentId surfaces as null → handler skips that
    // cross-check (see anti-tampering tests in payment.service.test.ts).
    mockPaymentService.handleWebhook.mockResolvedValue(undefined);
    mockProvider.verifyWebhook.mockReturnValue(true);

    const payload = {
      hash: "ok",
      invoice: { token: "TKN", total_amount: 5000 },
      // custom_data omitted entirely
      status: "completed",
    };
    const formBody = `data=${encodeURIComponent(JSON.stringify(payload))}`;

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/webhook/paydunya",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: formBody,
    });
    expect(res.statusCode).toBe(200);
    expect(mockPaymentService.handleWebhook).toHaveBeenCalledWith(
      "TKN",
      "succeeded",
      expect.objectContaining({
        expectedAmount: 5000,
        expectedPaymentId: null,
      }),
    );
  });
});

// ─── P1-16 (audit M6) — Zod validation on mock-checkout /complete ────────
//
// Dev-only route, but staging shares the code path whenever the real
// provider keys are unset (mock fallback). Without Zod validation, an
// attacker on staging with a known `txId` could send any body shape
// and `simulateCallback` would silently process it. The validate
// middleware enforces:
//   - txId: non-empty string ≤ 128 chars
//   - body: exactly { success: boolean }, strict (no extra fields)

describe("POST /v1/payments/mock-checkout/:txId/complete (P1-16)", () => {
  it("400 when body is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/mock-checkout/mock_tx_1/complete",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when 'success' is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/mock-checkout/mock_tx_2/complete",
      payload: { other: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when 'success' is not a boolean", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/mock-checkout/mock_tx_3/complete",
      payload: { success: "yes" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when extra fields are sent (strict mode)", async () => {
    // Strict mode rejects unknown keys so a malicious caller can't
    // smuggle `{ success: true, txId: "other-tx" }` to confuse a future
    // handler that opportunistically reads from the body.
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/mock-checkout/mock_tx_4/complete",
      payload: { success: true, sneaky: "value" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 with valid body when txId doesn't match a known mock state", async () => {
    // Valid Zod-shaped body — Zod passes, then the route asks the mock
    // provider for the state and gets `null`. 404 is the right
    // response shape for an unknown txId (matches /webhook/:provider
    // for unknown providers).
    const { __mockSimulateCallback } = (await import(
      "@/providers/mock-payment.provider"
    )) as unknown as { __mockSimulateCallback: ReturnType<typeof vi.fn> };
    __mockSimulateCallback.mockReturnValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/mock-checkout/mock_tx_unknown/complete",
      payload: { success: true },
    });
    expect(res.statusCode).toBe(404);
    expect(__mockSimulateCallback).toHaveBeenCalledWith("mock_tx_unknown", true);
  });

  it("200 with valid body and a known txId", async () => {
    const { __mockSimulateCallback } = (await import(
      "@/providers/mock-payment.provider"
    )) as unknown as { __mockSimulateCallback: ReturnType<typeof vi.fn> };
    __mockSimulateCallback.mockReturnValue({ status: "succeeded" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/mock-checkout/mock_tx_ok/complete",
      payload: { success: false },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      success: true,
      data: { status: "succeeded" },
    });
    expect(__mockSimulateCallback).toHaveBeenCalledWith("mock_tx_ok", false);
  });
});

// ─── Phase B-2 — POST /v1/payments/:paymentId/resume ─────────────────────

describe("POST /v1/payments/:paymentId/resume", () => {
  it("401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/pay-1/resume",
    });
    expect(res.statusCode).toBe(401);
    expect(mockPaymentService.resumePayment).not.toHaveBeenCalled();
  });

  it("403 when caller has no payment:initiate permission (default participant)", async () => {
    // Override the default participant to a no-perm user.
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "test-user",
      email: "test@example.com",
      email_verified: true,
      roles: [],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/pay-1/resume",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(403);
    expect(mockPaymentService.resumePayment).not.toHaveBeenCalled();
  });

  it("403 when caller's email is not verified (paid-flow guard)", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "buyer-1",
      email: "buyer@example.com",
      email_verified: false,
      roles: ["participant"],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/pay-1/resume",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(403);
    expect(mockPaymentService.resumePayment).not.toHaveBeenCalled();
  });

  it("200 forwards to service.resumePayment and returns the redirectUrl", async () => {
    mockPaymentService.resumePayment.mockResolvedValue({
      paymentId: "pay-1",
      redirectUrl: "https://paydunya.com/checkout/invoice/abc",
      status: "processing",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/pay-1/resume",
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      success: true,
      data: {
        paymentId: "pay-1",
        redirectUrl: "https://paydunya.com/checkout/invoice/abc",
        status: "processing",
      },
    });
    expect(mockPaymentService.resumePayment).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({ uid: "participant-1" }),
    );
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
