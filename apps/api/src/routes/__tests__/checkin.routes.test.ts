import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { checkinRoutes } from "../checkin.routes";

// ─── Mock auth middleware ──────────────────────────────────────────────────

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  db: {},
  COLLECTIONS: { REGISTRATIONS: "registrations", EVENTS: "events" },
}));

// ─── Mock checkin service ──────────────────────────────────────────────────

const mockCheckinService = {
  getOfflineSyncData: vi.fn(),
  bulkSync: vi.fn(),
  getStats: vi.fn(),
  getHistory: vi.fn(),
};

vi.mock("@/services/checkin.service", () => ({
  checkinService: new Proxy(
    {},
    {
      get: (_target, prop) => (mockCheckinService as Record<string, unknown>)[prop as string],
    },
  ),
}));

// ─── Build app ────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(checkinRoutes, { prefix: "/v1/events" });

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
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function authHeaders(overrides: Record<string, unknown> = {}) {
  mockVerifyIdToken.mockResolvedValue({
    uid: "staff-1",
    email: "staff@teranga.events",
    roles: ["staff"],
    organizationId: "org-1",
    ...overrides,
  });
  return { authorization: "Bearer valid-token" };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("GET /v1/events/:eventId/sync", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/ev-1/sync",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns offline sync data", async () => {
    const headers = authHeaders();
    mockCheckinService.getOfflineSyncData.mockResolvedValue({
      eventId: "ev-1",
      organizationId: "org-1",
      eventTitle: "Test Event",
      syncedAt: new Date().toISOString(),
      totalRegistrations: 1,
      registrations: [],
      accessZones: [],
      ticketTypes: [],
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/events/ev-1/sync",
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().data.eventId).toBe("ev-1");
  });
});

describe("POST /v1/events/:eventId/checkin/sync", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events/ev-1/checkin/sync",
      headers: { "content-type": "application/json" },
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("processes bulk check-in sync", async () => {
    const headers = authHeaders();
    mockCheckinService.bulkSync.mockResolvedValue({
      eventId: "ev-1",
      processed: 1,
      succeeded: 1,
      failed: 0,
      results: [{ localId: "local-1", status: "success", registrationId: "reg-1" }],
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/events/ev-1/checkin/sync",
      headers: { ...headers, "content-type": "application/json" },
      payload: {
        items: [
          {
            localId: "local-1",
            qrCodeValue: "test-qr",
            scannedAt: new Date().toISOString(),
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.succeeded).toBe(1);
  });
});

describe("GET /v1/events/:eventId/checkin/history", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/ev-1/checkin/history",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns paginated check-in history", async () => {
    const headers = authHeaders({ roles: ["organizer"] });
    mockCheckinService.getHistory.mockResolvedValue({
      data: [
        {
          registrationId: "reg-1",
          participantName: "Alice",
          participantEmail: "alice@test.com",
          ticketTypeName: "Standard",
          accessZoneName: null,
          checkedInAt: new Date().toISOString(),
          checkedInBy: "staff-1",
          staffName: "Staff",
          source: "live",
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/events/ev-1/checkin/history?page=1&limit=20",
      headers,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].participantName).toBe("Alice");
    expect(body.meta.total).toBe(1);
  });

  it("passes query filters to service", async () => {
    const headers = authHeaders({ roles: ["organizer"] });
    mockCheckinService.getHistory.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await app.inject({
      method: "GET",
      url: "/v1/events/ev-1/checkin/history?q=alice&accessZoneId=zone-1",
      headers,
    });

    expect(mockCheckinService.getHistory).toHaveBeenCalledWith(
      "ev-1",
      expect.objectContaining({ q: "alice", accessZoneId: "zone-1" }),
      expect.objectContaining({ uid: "staff-1" }),
    );
  });
});

describe("GET /v1/events/:eventId/checkin/stats", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/ev-1/checkin/stats",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns check-in statistics", async () => {
    const headers = authHeaders({ roles: ["organizer"] });
    mockCheckinService.getStats.mockResolvedValue({
      eventId: "ev-1",
      totalRegistered: 100,
      totalCheckedIn: 42,
      totalPending: 5,
      totalCancelled: 3,
      byZone: [],
      byTicketType: [],
      lastCheckinAt: null,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/events/ev-1/checkin/stats",
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.totalCheckedIn).toBe(42);
  });
});
