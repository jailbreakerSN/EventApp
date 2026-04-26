import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registrationRoutes } from "../registrations.routes";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
}));

const mockRegistrationService = {
  cancel: vi.fn(),
  cancelPending: vi.fn(),
  approve: vi.fn(),
  checkIn: vi.fn(),
  getEventRegistrations: vi.fn(),
  register: vi.fn(),
  getMyRegistrations: vi.fn(),
  getMyRegistrationForEvent: vi.fn(),
};

vi.mock("@/services/registration.service", () => ({
  registrationService: new Proxy(
    {},
    {
      get: (_t, p) => (mockRegistrationService as Record<string, unknown>)[p as string],
    },
  ),
}));

// ─── App boot ──────────────────────────────────────────────────────────────
//
// Tests the NEW routes added in the post-audit endpoint-drift PR:
//   - POST /:registrationId/cancel  (alias for DELETE, matches both web clients)
//   - PATCH /:registrationId         (dispatches to approve / cancel based on target status)
//
// Both frontend apps have been calling these paths and getting 404s
// because the API only had DELETE + POST /approve. These tests pin the
// new aliases so the drift can't silently come back.

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(registrationRoutes, { prefix: "/v1/registrations" });
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
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
  // Every test is authenticated as an organizer unless it overrides.
  mockVerifyIdToken.mockResolvedValue({
    uid: "organizer-1",
    email: "org@example.com",
    email_verified: true,
    roles: ["organizer"],
    organizationId: "org-1",
  });
});

const authHeader = { authorization: "Bearer mock-token" };

describe("Registration routes — aliases for web client compatibility", () => {
  it("POST /:registrationId/cancel calls registrationService.cancel", async () => {
    mockRegistrationService.cancel.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/v1/registrations/reg-42/cancel",
      headers: authHeader,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(mockRegistrationService.cancel).toHaveBeenCalledWith("reg-42", expect.any(Object));
    expect(JSON.parse(res.body)).toMatchObject({
      success: true,
      data: { id: "reg-42", status: "cancelled" },
    });
  });

  it("DELETE /:registrationId still works (canonical REST form)", async () => {
    mockRegistrationService.cancel.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/registrations/reg-42",
      headers: authHeader,
    });

    expect(res.statusCode).toBe(204);
    expect(mockRegistrationService.cancel).toHaveBeenCalledWith("reg-42", expect.any(Object));
  });

  it("PATCH /:registrationId with status=confirmed dispatches to approve", async () => {
    mockRegistrationService.approve.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/registrations/reg-42",
      headers: authHeader,
      payload: { status: "confirmed" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockRegistrationService.approve).toHaveBeenCalledWith("reg-42", expect.any(Object));
    expect(mockRegistrationService.cancel).not.toHaveBeenCalled();
    expect(JSON.parse(res.body)).toMatchObject({
      success: true,
      data: { id: "reg-42", status: "confirmed" },
    });
  });

  it("PATCH /:registrationId with status=cancelled dispatches to cancel", async () => {
    mockRegistrationService.cancel.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/registrations/reg-42",
      headers: authHeader,
      payload: { status: "cancelled" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockRegistrationService.cancel).toHaveBeenCalledWith("reg-42", expect.any(Object));
    expect(mockRegistrationService.approve).not.toHaveBeenCalled();
  });

  it("PATCH /:registrationId rejects unknown status values", async () => {
    // Zod refuses status values other than confirmed/cancelled so we
    // don't accidentally turn PATCH into a free-form status mutation
    // that skips the audit-emission side effects.
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/registrations/reg-42",
      headers: authHeader,
      payload: { status: "checked_in" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockRegistrationService.approve).not.toHaveBeenCalled();
    expect(mockRegistrationService.cancel).not.toHaveBeenCalled();
  });

  it("POST /:registrationId/cancel requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/registrations/reg-42/cancel",
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(mockRegistrationService.cancel).not.toHaveBeenCalled();
  });
});

// ─── Phase B-1 — GET /v1/registrations/me/event/:eventId ─────────────────

describe("GET /v1/registrations/me/event/:eventId", () => {
  it("401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/registrations/me/event/event-1",
    });
    expect(res.statusCode).toBe(401);
    expect(mockRegistrationService.getMyRegistrationForEvent).not.toHaveBeenCalled();
  });

  it("403 when caller lacks registration:read_own permission", async () => {
    // Pin the route-layer requirePermission gate added post-security
    // review. A token with no role doesn't compute the permission, so
    // the middleware must reject before any service call.
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "test-user",
      email: "test@example.com",
      email_verified: true,
      roles: [],
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/registrations/me/event/event-1",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(403);
    expect(mockRegistrationService.getMyRegistrationForEvent).not.toHaveBeenCalled();
  });

  it("200 returns the user's current registration when present", async () => {
    mockRegistrationService.getMyRegistrationForEvent.mockResolvedValue({
      id: "reg-1",
      status: "pending_payment",
      eventId: "event-1",
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/registrations/me/event/event-1",
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("pending_payment");
    expect(mockRegistrationService.getMyRegistrationForEvent).toHaveBeenCalledWith(
      "event-1",
      expect.objectContaining({ uid: "organizer-1" }),
    );
  });

  it("200 returns null when no registration exists (caller renders 'Register' CTA)", async () => {
    mockRegistrationService.getMyRegistrationForEvent.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: "/v1/registrations/me/event/event-99",
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, data: null });
  });
});

// ─── Phase B-3 — POST /v1/registrations/:registrationId/cancel-pending ───

describe("POST /v1/registrations/:registrationId/cancel-pending", () => {
  it("401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/registrations/reg-1/cancel-pending",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(mockRegistrationService.cancelPending).not.toHaveBeenCalled();
  });

  it("403 when caller lacks registration:cancel_own permission", async () => {
    // Override the default authed-as-organizer to a no-perm user.
    // Organizer DOES have cancel_own (inherits from participant), so
    // we explicitly strip permissions for this test.
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "test-user",
      email: "test@example.com",
      email_verified: true,
      roles: [],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/registrations/reg-1/cancel-pending",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(403);
    expect(mockRegistrationService.cancelPending).not.toHaveBeenCalled();
  });

  it("200 forwards to service.cancelPending and returns the cancelled status", async () => {
    mockRegistrationService.cancelPending.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/v1/registrations/reg-1/cancel-pending",
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      success: true,
      data: { id: "reg-1", status: "cancelled" },
    });
    expect(mockRegistrationService.cancelPending).toHaveBeenCalledWith(
      "reg-1",
      expect.objectContaining({ uid: "organizer-1" }),
    );
  });

  it("400 surfaces the service-layer ValidationError when status isn't pending_payment", async () => {
    // Service throws ValidationError for confirmed/cancelled/etc.
    mockRegistrationService.cancelPending.mockRejectedValueOnce(
      Object.assign(
        new Error("Cette opération ne s'applique qu'aux inscriptions en attente de paiement."),
        { statusCode: 400 },
      ),
    );
    const res = await app.inject({
      method: "POST",
      url: "/v1/registrations/reg-1/cancel-pending",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
  });
});
