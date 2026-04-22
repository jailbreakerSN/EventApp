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
  // Phase 2.4 — routes run their upsert+history-append inside
  // db.runTransaction. Hand back a transaction stub with no-op set/get/update
  // so the existing route tests can exercise the PUT path without a real
  // Firestore.
  db: {
    collection: () => ({
      doc: () => ({ set: async () => undefined }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ set: () => undefined, update: () => undefined, get: async () => ({ exists: false }) }),
  },
  COLLECTIONS: {
    NOTIFICATION_SETTINGS: "notificationSettings",
    NOTIFICATION_SETTINGS_HISTORY: "notificationSettingsHistory",
    NOTIFICATION_DISPATCH_LOG: "notificationDispatchLog",
  },
}));

// Phase 2.4 — new repositories + services touched by the admin routes.
// Keep them as light mocks so the admin routes test file focuses on the
// HTTP layer; the individual services/repositories have their own suites.
vi.mock("@/repositories/notification-settings-history.repository", () => ({
  notificationSettingsHistoryRepository: {
    append: vi.fn(async () => "history-id-1"),
    listByKey: vi.fn(async () => []),
  },
  computeSettingDiff: () => ["enabled"],
}));

vi.mock("@/services/notifications/setting-resolution", () => ({
  settingResolutionService: {
    resolve: vi.fn(),
    merge: vi.fn(),
  },
}));

vi.mock("@/services/notifications/preview.service", () => ({
  notificationPreviewService: {
    preview: vi.fn(async () => ({
      subject: "Preview subject",
      html: "<p>preview</p>",
      previewText: "preview text",
    })),
  },
}));

vi.mock("@/services/notification-dispatcher.service", () => ({
  notificationDispatcher: {
    dispatch: vi.fn(async () => undefined),
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

interface MockSetting {
  key: string;
  enabled: boolean;
  channels: string[];
  subjectOverride?: Record<string, string>;
  updatedAt: string;
  updatedBy: string;
}

const mockNotificationSettingsRepository = {
  listAll: vi.fn(async (): Promise<MockSetting[]> => []),
  listAllPerOrg: vi.fn(async (): Promise<MockSetting[]> => []),
  findByKey: vi.fn(async (): Promise<MockSetting | null> => null),
  findByKeyAndOrg: vi.fn(async (): Promise<MockSetting | null> => null),
  upsert: vi.fn(async () => undefined),
};

const mockNotificationDispatchLogRepository = {
  append: vi.fn(async () => "log-id"),
  aggregateStats: vi.fn(async () => ({})),
};

vi.mock("@/repositories/notification-settings.repository", () => ({
  notificationSettingsRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockNotificationSettingsRepository as Record<string, unknown>)[p as string],
    },
  ),
  notificationSettingDocId: (key: string, orgId: string | null) =>
    orgId ? `${key}__${orgId}` : key,
}));

vi.mock("@/repositories/notification-dispatch-log.repository", () => ({
  notificationDispatchLogRepository: new Proxy(
    {},
    {
      get: (_t, p) =>
        (mockNotificationDispatchLogRepository as Record<string, unknown>)[p as string],
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
  // Phase 5 — observability stats
  { method: "GET", url: "/v1/admin/notifications/stats?days=7" },
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
    // Phase 2.4 — the upsert now happens inside a Firestore transaction
    // (via tx.set) instead of through the repository wrapper, so we
    // assert on the fired audit event as the load-bearing observable.
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
        organizationId: null,
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

  it("GET /notifications/stats aggregates dispatch counts per key", async () => {
    mockNotificationDispatchLogRepository.aggregateStats.mockResolvedValue({
      "registration.created": {
        sent: 42,
        suppressed: 3,
        suppressionByReason: { user_opted_out: 2, bounced: 1 },
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/notifications/stats?days=14",
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.windowDays).toBe(14);
    expect(body.data.stats["registration.created"]).toMatchObject({
      sent: 42,
      suppressed: 3,
    });
    expect(mockNotificationDispatchLogRepository.aggregateStats).toHaveBeenCalledWith(14);
  });

  it("GET /notifications/stats rejects days > 90", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/notifications/stats?days=120",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Phase 2.4 — Preview, Test-send, History ─────────────────────────────

describe("Admin notification control plane (Phase 2.4)", () => {
  it("POST /notifications/:key/preview returns rendered HTML + subject", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/notifications/registration.created/preview",
      headers: { ...authHeader, "content-type": "application/json" },
      payload: { locale: "fr" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.subject).toBe("Preview subject");
    expect(body.data.html).toBe("<p>preview</p>");
    expect(body.data.previewText).toBe("preview text");
  });

  it("POST /notifications/:key/preview rejects unknown keys (404)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/notifications/not.a.real.key/preview",
      headers: { ...authHeader, "content-type": "application/json" },
      payload: { locale: "fr" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /notifications/:key/test-send dispatches with testMode and returns subject", async () => {
    const { notificationDispatcher } = (await import(
      "@/services/notification-dispatcher.service"
    )) as unknown as {
      notificationDispatcher: { dispatch: ReturnType<typeof vi.fn> };
    };

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/notifications/registration.created/test-send",
      headers: { ...authHeader, "content-type": "application/json" },
      payload: { email: "qa@teranga.events", locale: "fr" },
    });

    expect(res.statusCode).toBe(200);
    expect(notificationDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "registration.created",
        recipients: [{ email: "qa@teranga.events", preferredLocale: "fr" }],
        testMode: true,
      }),
      expect.objectContaining({ actorId: "super-1" }),
    );
  });

  it("POST /notifications/:key/test-send rejects unsupported channels (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/notifications/registration.created/test-send",
      headers: { ...authHeader, "content-type": "application/json" },
      payload: { email: "qa@teranga.events", locale: "fr", channels: ["sms"] },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("INVALID_CHANNEL");
  });

  it("GET /notifications/:key/history returns history entries", async () => {
    const { notificationSettingsHistoryRepository } = (await import(
      "@/repositories/notification-settings-history.repository"
    )) as unknown as {
      notificationSettingsHistoryRepository: { listByKey: ReturnType<typeof vi.fn> };
    };
    notificationSettingsHistoryRepository.listByKey.mockResolvedValueOnce([
      {
        id: "hist-1",
        key: "registration.created",
        organizationId: null,
        previousValue: null,
        newValue: {
          key: "registration.created",
          organizationId: null,
          enabled: false,
          channels: ["email"],
          updatedAt: "2026-04-22T10:00:00.000Z",
          updatedBy: "super-1",
        },
        diff: ["enabled"],
        actorId: "super-1",
        actorRole: "super_admin",
        changedAt: "2026-04-22T10:00:00.000Z",
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/notifications/registration.created/history?limit=10",
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.count).toBe(1);
    expect(body.data.entries[0].id).toBe("hist-1");
    expect(notificationSettingsHistoryRepository.listByKey).toHaveBeenCalledWith(
      "registration.created",
      null,
      10,
    );
  });

  it("GET /notifications/:key/history scopes by organizationId query param", async () => {
    const { notificationSettingsHistoryRepository } = (await import(
      "@/repositories/notification-settings-history.repository"
    )) as unknown as {
      notificationSettingsHistoryRepository: { listByKey: ReturnType<typeof vi.fn> };
    };

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/notifications/registration.created/history?organizationId=org-1",
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    expect(notificationSettingsHistoryRepository.listByKey).toHaveBeenCalledWith(
      "registration.created",
      "org-1",
      50,
    );
  });

  it("GET /notifications/per-org surfaces every scoped override", async () => {
    mockNotificationSettingsRepository.listAllPerOrg.mockResolvedValueOnce([
      {
        key: "event.reminder",
        organizationId: "org-a",
        enabled: false,
        channels: ["email"],
        updatedAt: "2026-04-22T10:00:00.000Z",
        updatedBy: "organizer-1",
      } as unknown as MockSetting,
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/notifications/per-org",
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data[0]).toMatchObject({
      key: "event.reminder",
      organizationId: "org-a",
      enabled: false,
    });
  });
});
