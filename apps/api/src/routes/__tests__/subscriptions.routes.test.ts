import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { subscriptionRoutes } from "../subscriptions.routes";
import { AppError } from "@/errors/app-error";

// ─── Subscriptions route coverage ──────────────────────────────────────────
// Route-level regression floor for the org billing surface. Every
// mutation here ultimately moves money / plan limits, so the auth +
// permission + email-verification chain MUST stay exact. This file
// covers the wiring (Fastify → middleware → service call → response
// shape); the service-level semantics live in
// `services/__tests__/subscription.service.test.ts`.

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
}));

const mockSubscriptionService = {
  getSubscription: vi.fn(),
  getUsage: vi.fn(),
  upgrade: vi.fn(),
  downgrade: vi.fn(),
  cancel: vi.fn(),
  revertScheduledChange: vi.fn(),
};

vi.mock("@/services/subscription.service", () => ({
  subscriptionService: new Proxy(
    {},
    {
      get: (_t, p) => (mockSubscriptionService as Record<string, unknown>)[p as string],
    },
  ),
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(subscriptionRoutes);
  // Mirror the production error handler enough that AppError subclasses
  // surface their status code. Keeping the shape minimal — the goal is
  // to validate the middleware chain, not to re-test error formatting.
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
  // Default: authenticated organizer with email verified + billing permission
  // (organizer role resolves to `organization:manage_billing`).
  mockVerifyIdToken.mockResolvedValue({
    uid: "org-admin-1",
    email: "billing@example.com",
    email_verified: true,
    roles: ["organizer"],
    organizationId: "org-1",
  });
});

const authHeader = { authorization: "Bearer mock-token" };

describe("Subscription routes — auth chain", () => {
  it("GET /subscription without auth → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/organizations/org-1/subscription",
      // no authorization header
    });
    expect(res.statusCode).toBe(401);
    expect(mockSubscriptionService.getSubscription).not.toHaveBeenCalled();
  });

  it("GET /subscription as participant → 403 (missing manage_billing)", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "participant-1",
      email: "p@example.com",
      email_verified: true,
      roles: ["participant"],
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/organizations/org-1/subscription",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(403);
    expect(mockSubscriptionService.getSubscription).not.toHaveBeenCalled();
  });

  it("GET /subscription as organizer → 200", async () => {
    mockSubscriptionService.getSubscription.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/organizations/org-1/subscription",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(mockSubscriptionService.getSubscription).toHaveBeenCalledWith(
      "org-1",
      expect.any(Object),
    );
    expect(JSON.parse(res.body)).toMatchObject({
      success: true,
      data: { plan: "pro", status: "active" },
    });
  });

  it("POST /subscription/upgrade requires email verified (organizer with unverified email → 403)", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "org-admin-1",
      email: "billing@example.com",
      email_verified: false,
      roles: ["organizer"],
      organizationId: "org-1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/subscription/upgrade",
      headers: authHeader,
      payload: { plan: "pro" },
    });
    expect(res.statusCode).toBe(403);
    expect(mockSubscriptionService.upgrade).not.toHaveBeenCalled();
  });
});

describe("Subscription routes — mutations", () => {
  it("POST /subscription/upgrade validates body (missing plan → 400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/subscription/upgrade",
      headers: authHeader,
      payload: {}, // missing `plan`
    });
    expect(res.statusCode).toBe(400);
    expect(mockSubscriptionService.upgrade).not.toHaveBeenCalled();
  });

  it("POST /subscription/upgrade happy path returns 200 + subscription", async () => {
    mockSubscriptionService.upgrade.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/subscription/upgrade",
      headers: authHeader,
      payload: { plan: "pro" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockSubscriptionService.upgrade).toHaveBeenCalledWith(
      "org-1",
      { plan: "pro" },
      expect.any(Object),
    );
  });

  it("POST /subscription/downgrade passes body.immediate to the service", async () => {
    mockSubscriptionService.downgrade.mockResolvedValue({ scheduled: true, plan: "starter" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/subscription/downgrade",
      headers: authHeader,
      payload: { plan: "starter", immediate: true },
    });
    expect(res.statusCode).toBe(200);
    expect(mockSubscriptionService.downgrade).toHaveBeenCalledWith(
      "org-1",
      "starter",
      expect.any(Object),
      { immediate: true },
    );
  });

  it("POST /subscription/cancel accepts empty body (defaults immediate=false)", async () => {
    mockSubscriptionService.cancel.mockResolvedValue({ cancelled: true });

    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/subscription/cancel",
      headers: authHeader,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(mockSubscriptionService.cancel).toHaveBeenCalledWith("org-1", expect.any(Object), {
      immediate: false,
      reason: undefined,
    });
  });

  it("POST /subscription/revert-scheduled returns 200 when service succeeds", async () => {
    mockSubscriptionService.revertScheduledChange.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/subscription/revert-scheduled",
      headers: authHeader,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(mockSubscriptionService.revertScheduledChange).toHaveBeenCalledWith(
      "org-1",
      expect.any(Object),
    );
  });
});
