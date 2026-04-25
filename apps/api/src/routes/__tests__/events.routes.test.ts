import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { eventRoutes } from "../events.routes";
import { buildEvent } from "@/__tests__/factories";

// ─── Mock auth middleware ──────────────────────────────────────────────────

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  // B2 PR — the waitlist bulk-promote route imports `eventRepository` +
  // `registrationService`, which transitively pull `db` + `COLLECTIONS`
  // via this module. Stubbing them keeps the route-level test focused
  // on the auth/permission wiring without dragging in a full
  // Firestore mock.
  db: {},
  COLLECTIONS: {
    EVENTS: "events",
    REGISTRATIONS: "registrations",
  },
}));

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: {
    findByIdOrThrow: vi.fn(),
  },
}));

vi.mock("@/services/registration.service", () => ({
  registrationService: {
    bulkPromoteWaitlisted: vi.fn(),
  },
}));

// ─── Mock event service ─────────────────────────────────────────────────────

const mockEventService = {
  listPublished: vi.fn(),
  search: vi.fn(),
  listByOrganization: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  cancel: vi.fn(),
  archive: vi.fn(),
  addTicketType: vi.fn(),
  updateTicketType: vi.fn(),
  removeTicketType: vi.fn(),
};

const mockUploadService = {
  generateUploadUrl: vi.fn(),
};

vi.mock("@/services/upload.service", () => ({
  uploadService: new Proxy(
    {},
    {
      get: (_target, prop) => (mockUploadService as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/services/event.service", () => ({
  eventService: new Proxy(
    {},
    {
      get: (_target, prop) => (mockEventService as Record<string, unknown>)[prop as string],
    },
  ),
}));

// ─── Build app ───────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  // Register event routes at /v1/events to match real prefix
  await app.register(eventRoutes, { prefix: "/v1/events" });

  // Minimal error handler for clean assertions
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(overrides: Record<string, unknown> = {}) {
  mockVerifyIdToken.mockResolvedValue({
    uid: "user-1",
    email: "test@teranga.events",
    email_verified: true, // matches buildAuthUser() default — see factories.ts
    roles: ["organizer"],
    organizationId: "org-1",
    ...overrides,
  });
  return { authorization: "Bearer valid-token" };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /v1/events", () => {
  it("returns paginated event list", async () => {
    const events = [buildEvent(), buildEvent()];
    mockEventService.search.mockResolvedValue({
      data: events,
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/events?page=1&limit=20",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
  });

  it("does not require authentication", async () => {
    mockEventService.search.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const res = await app.inject({ method: "GET", url: "/v1/events" });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /v1/events/org/:orgId", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/org/org-1",
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns paginated org-scoped event list", async () => {
    const headers = authHeaders();
    const events = [
      buildEvent({ organizationId: "org-1" }),
      buildEvent({ organizationId: "org-1" }),
    ];
    mockEventService.listByOrganization.mockResolvedValue({
      data: events,
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/events/org/org-1?page=1&limit=20",
      headers,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
    expect(mockEventService.listByOrganization).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ uid: "user-1" }),
      expect.objectContaining({ page: 1, limit: 20 }),
      expect.objectContaining({ category: undefined, status: undefined }),
    );
  });

  it("passes category filter through to the service", async () => {
    const headers = authHeaders();
    mockEventService.listByOrganization.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/events/org/org-1?category=workshop&status=published",
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(mockEventService.listByOrganization).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ uid: "user-1" }),
      expect.any(Object),
      expect.objectContaining({ category: "workshop", status: "published" }),
    );
  });

  it("rejects unknown category with a 4xx validation error", async () => {
    const headers = authHeaders();
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/org/org-1?category=not-a-category",
      headers,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it("returns 403 for participant without event:read permission", async () => {
    const headers = authHeaders({ roles: ["participant"] });
    mockEventService.listByOrganization.mockRejectedValue(
      Object.assign(new Error("Missing permission: event:read"), { statusCode: 403 }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/v1/events/org/org-1",
      headers,
    });

    expect(res.statusCode).toBe(403);
  });

  it("passes pagination params correctly", async () => {
    const headers = authHeaders();
    mockEventService.listByOrganization.mockResolvedValue({
      data: [],
      meta: { page: 2, limit: 10, total: 15, totalPages: 2 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/events/org/org-1?page=2&limit=10&orderBy=startDate&orderDir=asc",
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().meta.page).toBe(2);
  });
});

describe("GET /v1/events/:eventId", () => {
  it("returns event by ID", async () => {
    const event = buildEvent({ id: "ev-1" });
    mockEventService.getById.mockResolvedValue(event);

    const res = await app.inject({
      method: "GET",
      url: "/v1/events/ev-1",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe("ev-1");
  });
});

describe("POST /v1/events", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 201 on successful creation", async () => {
    const headers = authHeaders();
    const event = buildEvent({ title: "New Event" });
    mockEventService.create.mockResolvedValue(event);

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { ...headers, "content-type": "application/json" },
      payload: {
        organizationId: "org-1",
        title: "New Event",
        description: "Description",
        category: "conference",
        format: "in_person",
        status: "draft",
        startDate: new Date(Date.now() + 86400000).toISOString(),
        endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
        timezone: "Africa/Dakar",
        location: { name: "CICAD", address: "Diamniadio", city: "Dakar", country: "SN" },
        isPublic: true,
        isFeatured: false,
        requiresApproval: false,
        ticketTypes: [],
        accessZones: [],
        tags: [],
        maxAttendees: null,
        shortDescription: null,
        coverImageURL: null,
        bannerImageURL: null,
        templateId: null,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().success).toBe(true);
    expect(res.json().data.title).toBe("New Event");
  });

  it("returns 403 for participant without event:create", async () => {
    const headers = authHeaders({ roles: ["participant"] });
    mockEventService.create.mockRejectedValue(
      Object.assign(new Error("Missing permission: event:create"), { statusCode: 403 }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { ...headers, "content-type": "application/json" },
      payload: { organizationId: "org-1", title: "Nope" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/events/:eventId", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/events/ev-1",
      headers: { "content-type": "application/json" },
      payload: { title: "Updated" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("updates event successfully and returns full event", async () => {
    const headers = authHeaders();
    const event = buildEvent({ id: "ev-1", title: "Updated Title" });
    mockEventService.update.mockResolvedValue(undefined);
    mockEventService.getById.mockResolvedValue(event);

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/events/ev-1",
      headers: { ...headers, "content-type": "application/json" },
      payload: { title: "Updated Title" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe("Updated Title");
  });
});

describe("POST /v1/events/:eventId/publish", () => {
  it("publishes event and returns 200", async () => {
    const headers = authHeaders();
    mockEventService.publish.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/v1/events/ev-1/publish",
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("published");
  });
});

describe("POST /v1/events/:eventId/cancel", () => {
  it("cancels event and returns 200", async () => {
    const headers = authHeaders();
    mockEventService.cancel.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/v1/events/ev-1/cancel",
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("cancelled");
  });
});

describe("POST /v1/events/:eventId/unpublish", () => {
  it("unpublishes event and returns 200", async () => {
    const headers = authHeaders();
    mockEventService.unpublish.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/v1/events/ev-1/unpublish",
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("draft");
  });
});

describe("POST /v1/events/:eventId/ticket-types", () => {
  it("adds a ticket type and returns 201", async () => {
    const headers = authHeaders();
    const event = buildEvent({
      ticketTypes: [
        {
          id: "tt-new",
          name: "VIP",
          price: 5000,
          currency: "XOF",
          totalQuantity: 50,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
    });
    mockEventService.addTicketType.mockResolvedValue(event);

    const res = await app.inject({
      method: "POST",
      url: "/v1/events/ev-1/ticket-types",
      headers: { ...headers, "content-type": "application/json" },
      payload: {
        name: "VIP",
        price: 5000,
        currency: "XOF",
        totalQuantity: 50,
        accessZoneIds: [],
        isVisible: true,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().success).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events/ev-1/ticket-types",
      headers: { "content-type": "application/json" },
      payload: { name: "VIP" },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /v1/events/:eventId/ticket-types/:ticketTypeId", () => {
  it("updates a ticket type and returns 200", async () => {
    const headers = authHeaders();
    const event = buildEvent({
      ticketTypes: [
        {
          id: "tt-1",
          name: "VIP Updated",
          price: 10000,
          currency: "XOF",
          totalQuantity: 50,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
    });
    mockEventService.updateTicketType.mockResolvedValue(event);

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/events/ev-1/ticket-types/tt-1",
      headers: { ...headers, "content-type": "application/json" },
      payload: { name: "VIP Updated", price: 10000 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/events/ev-1/ticket-types/tt-1",
      headers: { "content-type": "application/json" },
      payload: { name: "VIP" },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("DELETE /v1/events/:eventId/ticket-types/:ticketTypeId", () => {
  it("removes a ticket type and returns 204", async () => {
    const headers = authHeaders();
    mockEventService.removeTicketType.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/events/ev-1/ticket-types/tt-1",
      headers,
    });

    expect(res.statusCode).toBe(204);
  });
});

describe("DELETE /v1/events/:eventId", () => {
  it("archives event and returns 204", async () => {
    const headers = authHeaders();
    mockEventService.archive.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/events/ev-1",
      headers,
    });

    expect(res.statusCode).toBe(204);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/events/ev-1",
    });

    expect(res.statusCode).toBe(401);
  });
});
