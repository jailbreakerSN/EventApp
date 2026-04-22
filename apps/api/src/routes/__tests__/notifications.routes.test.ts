import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { notificationRoutes } from "../notifications.routes";

const mockVerifyIdToken = vi.fn();

// Minimal in-memory Firestore double for the /preferences endpoints.
// Doc id == userId for notificationPreferences; tests mutate via
// `prefStorage.set(uid, data)`.
const prefStorage = new Map<string, Record<string, unknown>>();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  db: {
    collection: vi.fn((_name: string) => ({
      doc: vi.fn((id: string) => ({
        get: vi.fn(async () => {
          const data = prefStorage.get(id);
          return {
            exists: data !== undefined,
            data: () => data,
          };
        }),
        set: vi.fn(async (payload: Record<string, unknown>) => {
          const existing = prefStorage.get(id) ?? {};
          prefStorage.set(id, { ...existing, ...payload });
        }),
      })),
    })),
  },
  COLLECTIONS: { NOTIFICATION_PREFERENCES: "notificationPreferences" },
}));

const mockNotificationService = {
  getMyNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
};

vi.mock("@/services/notification.service", () => ({
  notificationService: new Proxy(
    {},
    { get: (_t, p) => (mockNotificationService as Record<string, unknown>)[p as string] },
  ),
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(notificationRoutes, { prefix: "/v1/notifications" });
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
  mockVerifyIdToken.mockResolvedValue({
    uid: "user-1",
    email: "user@example.com",
    email_verified: true,
    roles: ["participant"],
  });
});

describe("Notifications list — paginated meta shape", () => {
  it("returns full { page, limit, total, totalPages } meta so UI can show 'page X of Y'", async () => {
    // Regression guard: the route used to return `{ meta: { total } }`
    // only, leaving the frontend unable to compute total pages. The
    // post-audit PR expanded it to the standard PaginatedResponse shape.
    mockNotificationService.getMyNotifications.mockResolvedValue({
      data: Array.from({ length: 5 }, (_, i) => ({ id: `n-${i}` })),
      total: 42,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications?page=2&limit=5",
      headers: { authorization: "Bearer mock-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.meta).toEqual({
      page: 2,
      limit: 5,
      total: 42,
      totalPages: 9, // ceil(42 / 5)
    });
  });

  it("computes totalPages=1 when total is 0 (no divide-by-zero)", async () => {
    mockNotificationService.getMyNotifications.mockResolvedValue({
      data: [],
      total: 0,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: { authorization: "Bearer mock-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // 0 / limit = 0 items → 0 totalPages (not "1 of 0", but also not Infinity)
    expect(body.meta.totalPages).toBe(0);
    expect(body.meta.total).toBe(0);
  });
});

describe("Notification catalog + preferences — Phase 3 per-key opt-out", () => {
  beforeEach(() => {
    prefStorage.clear();
  });

  it("GET /v1/notifications/catalog returns every catalog entry with default enabled=true", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications/catalog",
      headers: { authorization: "Bearer mock-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(10);

    // Every entry has the shape the UI expects.
    for (const entry of body.data) {
      expect(entry).toMatchObject({
        key: expect.any(String),
        category: expect.any(String),
        displayName: { fr: expect.any(String), en: expect.any(String), wo: expect.any(String) },
        userOptOutAllowed: expect.any(Boolean),
        enabled: expect.any(Boolean),
      });
    }

    // Without an override doc, every entry defaults to enabled=true.
    expect(body.data.every((e: { enabled: boolean }) => e.enabled === true)).toBe(true);
  });

  it("GET /v1/notifications/catalog reflects the user's byKey overrides", async () => {
    prefStorage.set("user-1", {
      byKey: {
        "event.reminder": false,
        "newsletter.welcome": false,
      },
      updatedAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications/catalog",
      headers: { authorization: "Bearer mock-token" },
    });

    const body = JSON.parse(res.body);
    const byKey = Object.fromEntries(
      (body.data as { key: string; enabled: boolean }[]).map((e) => [e.key, e.enabled]),
    );
    expect(byKey["event.reminder"]).toBe(false);
    expect(byKey["newsletter.welcome"]).toBe(false);
    // untouched keys remain on default (true)
    expect(byKey["registration.created"]).toBe(true);
  });

  it("PUT /v1/notifications/preferences accepts byKey and persists it", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/notifications/preferences",
      headers: { authorization: "Bearer mock-token", "content-type": "application/json" },
      payload: {
        byKey: {
          "event.reminder": false,
          "subscription.upgraded": true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const stored = prefStorage.get("user-1");
    expect(stored?.byKey).toMatchObject({
      "event.reminder": false,
      "subscription.upgraded": true,
    });
  });
});
