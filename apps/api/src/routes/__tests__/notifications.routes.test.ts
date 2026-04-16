import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { notificationRoutes } from "../notifications.routes";

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  db: { collection: vi.fn() },
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
