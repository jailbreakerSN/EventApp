import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { adminRoutes } from "../admin.routes";
import { AppError } from "@/errors/app-error";

// ─── Admin route coverage ──────────────────────────────────────────────────
// The platform-admin surface. Every endpoint is gated behind
// `platform:manage`, which only `super_admin` holds. A regression
// here means a non-super-admin can touch cross-tenant data — the
// single most severe RBAC failure category in the product.
//
// This file pins:
//   - Every route rejects an un-authenticated request (401)
//   - Every route rejects an organizer / participant (403)
//   - super_admin can hit each route; service is invoked with the
//     correct args
//   - Mutating endpoints still validate their body schema
//
// Service semantics stay in `services/__tests__/admin.service.test.ts`.

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
}));

const mockAdminService = {
  getStats: vi.fn(),
  listUsers: vi.fn(),
  updateUserRoles: vi.fn(),
  updateUserStatus: vi.fn(),
  listOrganizations: vi.fn(),
  verifyOrganization: vi.fn(),
  updateOrgStatus: vi.fn(),
  listEvents: vi.fn(),
  listAuditLogs: vi.fn(),
};

const mockSubscriptionService = {
  assignPlan: vi.fn(),
};

vi.mock("@/services/admin.service", () => ({
  adminService: new Proxy(
    {},
    {
      get: (_t, p) => (mockAdminService as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/services/subscription.service", () => ({
  subscriptionService: new Proxy(
    {},
    {
      get: (_t, p) => (mockSubscriptionService as Record<string, unknown>)[p as string],
    },
  ),
}));

const mockNotificationSettingsRepository = {
  listAll: vi.fn(async () => []),
  findByKey: vi.fn(async () => null),
  upsert: vi.fn(async () => undefined),
};

vi.mock("@/repositories/notification-settings.repository", () => ({
  notificationSettingsRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockNotificationSettingsRepository as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(adminRoutes, { prefix: "/v1/admin" });
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
  // Default: super_admin with email verified.
  mockVerifyIdToken.mockResolvedValue({
    uid: "super-1",
    email: "platform@teranga.events",
    email_verified: true,
    roles: ["super_admin"],
  });
});

const authHeader = { authorization: "Bearer mock-token" };

// Table-driven denial matrix: every admin route MUST reject an
// organizer. If any row fails, a platform:manage gate was dropped or
// widened — the single most security-critical class of regression on
// this surface. Mutating routes use the payload that would otherwise
// pass body validation so the rejection comes from the permission
// middleware, not the validator.
const ORGANIZER_DENIED_MATRIX: Array<{
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  body?: Record<string, unknown>;
}> = [
  { method: "GET", url: "/v1/admin/stats" },
  { method: "GET", url: "/v1/admin/users" },
  { method: "PATCH", url: "/v1/admin/users/u-1/roles", body: { roles: ["participant"] } },
  { method: "PATCH", url: "/v1/admin/users/u-1/status", body: { isActive: false } },
  { method: "GET", url: "/v1/admin/organizations" },
  { method: "PATCH", url: "/v1/admin/organizations/org-1/verify", body: {} },
  { method: "PATCH", url: "/v1/admin/organizations/org-1/status", body: { isActive: false } },
  { method: "GET", url: "/v1/admin/events" },
  { method: "GET", url: "/v1/admin/audit-logs" },
  {
    method: "POST",
    url: "/v1/admin/organizations/org-1/subscription/assign",
    body: { planId: "plan-pro" },
  },
  // Phase 4 — notification control plane
  { method: "GET", url: "/v1/admin/notifications" },
  {
    method: "PUT",
    url: "/v1/admin/notifications/registration.created",
    body: { enabled: false, channels: ["email"] },
  },
];

describe("Admin routes — deny matrix (organizer role lacks platform:manage)", () => {
  for (const row of ORGANIZER_DENIED_MATRIX) {
    it(`${row.method} ${row.url} → 403 as organizer`, async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        uid: "org-admin-1",
        email: "org@example.com",
        email_verified: true,
        roles: ["organizer"],
        organizationId: "org-1",
      });
      const res = await app.inject({
        method: row.method,
        url: row.url,
        headers: authHeader,
        payload: row.body,
      });
      expect(res.statusCode).toBe(403);
    });
  }
});

describe("Admin routes — unauthenticated rejection", () => {
  for (const row of ORGANIZER_DENIED_MATRIX) {
    it(`${row.method} ${row.url} → 401 without auth`, async () => {
      const res = await app.inject({
        method: row.method,
        url: row.url,
        payload: row.body,
      });
      expect(res.statusCode).toBe(401);
    });
  }
});

describe("Admin routes — super_admin happy paths", () => {
  it("GET /stats → 200 with the service result", async () => {
    mockAdminService.getStats.mockResolvedValue({ totalOrgs: 5, totalEvents: 42 });

    const res = await app.inject({ method: "GET", url: "/v1/admin/stats", headers: authHeader });
    expect(res.statusCode).toBe(200);
    expect(mockAdminService.getStats).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ["super_admin"] }),
    );
    expect(JSON.parse(res.body)).toMatchObject({ success: true, data: { totalOrgs: 5 } });
  });

  it("PATCH /users/:userId/roles → 204 forwards the roles update", async () => {
    mockAdminService.updateUserRoles.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/users/u-42/roles",
      headers: authHeader,
      payload: { roles: ["organizer"] },
    });
    expect(res.statusCode).toBe(204);
    expect(mockAdminService.updateUserRoles).toHaveBeenCalledWith(expect.any(Object), "u-42", [
      "organizer",
    ]);
  });

  it("PATCH /users/:userId/roles → 400 on invalid body (missing roles)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/users/u-42/roles",
      headers: authHeader,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(mockAdminService.updateUserRoles).not.toHaveBeenCalled();
  });

  it("PATCH /organizations/:orgId/status → 204 forwards the suspension flag", async () => {
    mockAdminService.updateOrgStatus.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/organizations/org-1/status",
      headers: authHeader,
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(204);
    expect(mockAdminService.updateOrgStatus).toHaveBeenCalledWith(
      expect.any(Object),
      "org-1",
      false,
    );
  });

  it("POST /organizations/:orgId/subscription/assign → 200 calls subscriptionService.assignPlan", async () => {
    mockSubscriptionService.assignPlan.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      planId: "plan-pro",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/organizations/org-1/subscription/assign",
      headers: authHeader,
      payload: { planId: "plan-pro" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockSubscriptionService.assignPlan).toHaveBeenCalledWith(
      "org-1",
      { planId: "plan-pro" },
      expect.any(Object),
    );
  });

  it("GET /audit-logs → 200 forwards the query", async () => {
    mockAdminService.listAuditLogs.mockResolvedValue({
      data: [{ id: "log-1", action: "event.created" }],
      meta: { page: 1, limit: 20, total: 1 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/audit-logs?limit=10",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(mockAdminService.listAuditLogs).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ limit: 10 }),
    );
  });
});

describe("Admin notification control plane (Phase 4)", () => {
  it("GET /notifications returns every catalog entry merged with stored overrides", async () => {
    mockNotificationSettingsRepository.listAll.mockResolvedValue([
      {
        key: "event.reminder",
        enabled: false,
        channels: ["email"],
        updatedAt: "2026-04-22T10:00:00.000Z",
        updatedBy: "admin-1",
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/notifications",
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(10);

    // Overridden key surfaces enabled=false + hasOverride=true.
    const overridden = body.data.find((d: { key: string }) => d.key === "event.reminder");
    expect(overridden.enabled).toBe(false);
    expect(overridden.hasOverride).toBe(true);
    // Non-overridden key keeps catalog defaults.
    const vanilla = body.data.find((d: { key: string }) => d.key === "registration.created");
    expect(vanilla.hasOverride).toBe(false);
    expect(vanilla.enabled).toBe(true);
  });

  it("PUT /notifications/:key upserts the override + emits setting_updated", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/admin/notifications/event.reminder",
      headers: { ...authHeader, "content-type": "application/json" },
      payload: {
        enabled: false,
        channels: ["email"],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockNotificationSettingsRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "event.reminder",
        enabled: false,
        channels: ["email"],
        updatedBy: "super-1",
      }),
    );
    // Audit event fired.
    const { eventBus } = (await import("@/events/event-bus")) as unknown as {
      eventBus: { emit: ReturnType<typeof vi.fn> };
    };
    expect(eventBus.emit).toHaveBeenCalledWith(
      "notification.setting_updated",
      expect.objectContaining({
        key: "event.reminder",
        enabled: false,
        channels: ["email"],
        actorId: "super-1",
      }),
    );
  });

  it("PUT /notifications/:key rejects an unknown notification key (404)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/admin/notifications/not.a.real.key",
      headers: { ...authHeader, "content-type": "application/json" },
      payload: { enabled: false, channels: ["email"] },
    });
    expect(res.statusCode).toBe(404);
    expect(mockNotificationSettingsRepository.upsert).not.toHaveBeenCalled();
  });

  it("PUT /notifications/:key rejects unsupported channels (400)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/admin/notifications/registration.created",
      headers: { ...authHeader, "content-type": "application/json" },
      // Catalog has supportedChannels: ["email"] — "sms" is out of range.
      payload: { enabled: true, channels: ["sms"] },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("INVALID_CHANNEL");
  });
});
