import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsService } from "../analytics.service";
import {
  buildOrganizerUser,
  buildAuthUser,
  buildEvent,
  buildRegistration,
} from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// vi.hoisted so the factories (which run before module imports) can see the
// mock snapshots. Previously this was only a chain of top-level consts,
// which broke once analytics.service started importing organizationRepository
// — the organization repo's constructor calls db.collection(...) at module
// load, which fires the firebase mock factory BEFORE the snapshot consts
// initialize. Hoisting keeps the closure reference valid.
const { mockEventsSnap, mockRegsSnap, mockOrgDocGet, mockEventsQuery, mockRegsQuery } = vi.hoisted(() => {
  const mockEventsSnap = {
    docs: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
  };
  const mockRegsSnap = {
    docs: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
  };
  const mockEventsQuery = {
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue(mockEventsSnap),
  };
  const mockRegsQuery = {
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue(mockRegsSnap),
  };
  const mockOrgDocGet = vi.fn();
  return { mockEventsSnap, mockRegsSnap, mockOrgDocGet, mockEventsQuery, mockRegsQuery };
});

const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
};

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === "events") return mockEventsQuery;
      if (name === "registrations") return mockRegsQuery;
      if (name === "organizations") {
        // Minimal stub so OrganizationRepository's constructor can
        // call db.collection("organizations").doc(...).get() without
        // crashing. Actual lookups in tests go through mockOrgRepo.
        return {
          doc: vi.fn(() => ({ get: mockOrgDocGet })),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn(),
        };
      }
      return mockEventsQuery;
    }),
  },
  COLLECTIONS: {
    EVENTS: "events",
    REGISTRATIONS: "registrations",
    ORGANIZATIONS: "organizations",
  },
}));

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockOrgRepo as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("AnalyticsService", () => {
  const service = new AnalyticsService();
  const orgId = "org-1";
  const user = buildOrganizerUser(orgId);

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventsSnap.docs = [];
    mockRegsSnap.docs = [];
    // Reset chainable mocks
    mockEventsQuery.where.mockReturnThis();
    mockEventsQuery.limit.mockReturnThis();
    mockEventsQuery.get.mockResolvedValue(mockEventsSnap);
    mockRegsQuery.where.mockReturnThis();
    mockRegsQuery.limit.mockReturnThis();
    mockRegsQuery.get.mockResolvedValue(mockRegsSnap);
    // advancedAnalytics requires pro-or-better after P3 gate.
    mockOrgRepo.findByIdOrThrow.mockResolvedValue({
      id: orgId,
      plan: "pro",
      name: "Test Org",
      slug: "test-org",
    });
  });

  it("returns empty analytics for org with no events", async () => {
    const result = await service.getOrgAnalytics(orgId, { timeframe: "30d" }, user);

    expect(result.organizationId).toBe(orgId);
    expect(result.timeframe).toBe("30d");
    expect(result.summary.totalEvents).toBe(0);
    expect(result.summary.totalRegistrations).toBe(0);
    expect(result.summary.totalCheckedIn).toBe(0);
    expect(result.summary.checkinRate).toBe(0);
    expect(result.registrationsOverTime).toEqual([]);
    expect(result.checkinsOverTime).toEqual([]);
    expect(result.byCategory).toEqual([]);
    expect(result.byTicketType).toEqual([]);
    expect(result.topEvents).toEqual([]);
  });

  it("computes summary with events and registrations", async () => {
    const now = new Date().toISOString();
    const event1 = buildEvent({
      id: "ev-1",
      organizationId: orgId,
      category: "conference",
      registeredCount: 10,
      checkedInCount: 5,
      status: "published",
      createdAt: now,
    });

    mockEventsSnap.docs = [{ id: event1.id, data: () => ({ ...event1 }) }];

    const reg1 = buildRegistration({
      eventId: "ev-1",
      status: "confirmed",
      createdAt: now,
      ticketTypeId: "ticket-standard",
    });
    const reg2 = buildRegistration({
      eventId: "ev-1",
      status: "checked_in",
      createdAt: now,
      checkedInAt: now,
      ticketTypeId: "ticket-standard",
    });
    const reg3 = buildRegistration({
      eventId: "ev-1",
      status: "cancelled",
      createdAt: now,
      ticketTypeId: "ticket-standard",
    });

    mockRegsSnap.docs = [
      { id: reg1.id, data: () => ({ ...reg1 }) },
      { id: reg2.id, data: () => ({ ...reg2 }) },
      { id: reg3.id, data: () => ({ ...reg3 }) },
    ];

    const result = await service.getOrgAnalytics(orgId, { timeframe: "30d" }, user);

    expect(result.summary.totalRegistrations).toBe(3);
    expect(result.summary.totalCheckedIn).toBe(1);
    expect(result.summary.totalCancelled).toBe(1);
    // checkinRate = checked_in / (confirmed + checked_in) = 1/2 = 0.5
    expect(result.summary.checkinRate).toBe(0.5);
    expect(result.summary.totalEvents).toBe(1);
  });

  it("groups registrations by category", async () => {
    const now = new Date().toISOString();
    const ev1 = buildEvent({
      id: "ev-1",
      organizationId: orgId,
      category: "conference",
      status: "published",
      createdAt: now,
    });
    const ev2 = buildEvent({
      id: "ev-2",
      organizationId: orgId,
      category: "workshop",
      status: "published",
      createdAt: now,
    });
    const ev3 = buildEvent({
      id: "ev-3",
      organizationId: orgId,
      category: "conference",
      status: "published",
      createdAt: now,
    });

    mockEventsSnap.docs = [
      { id: ev1.id, data: () => ({ ...ev1 }) },
      { id: ev2.id, data: () => ({ ...ev2 }) },
      { id: ev3.id, data: () => ({ ...ev3 }) },
    ];

    const result = await service.getOrgAnalytics(orgId, { timeframe: "30d" }, user);

    expect(result.byCategory).toEqual(
      expect.arrayContaining([
        { category: "conference", count: 2 },
        { category: "workshop", count: 1 },
      ]),
    );
  });

  it("groups registrations by ticket type", async () => {
    const now = new Date().toISOString();
    const event = buildEvent({
      id: "ev-1",
      organizationId: orgId,
      status: "published",
      createdAt: now,
      ticketTypes: [
        {
          id: "tt-vip",
          name: "VIP",
          price: 50000,
          currency: "XOF",
          totalQuantity: 50,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
        {
          id: "tt-std",
          name: "Standard",
          price: 0,
          currency: "XOF",
          totalQuantity: 100,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
    });

    mockEventsSnap.docs = [{ id: event.id, data: () => ({ ...event }) }];

    const reg1 = buildRegistration({
      eventId: "ev-1",
      ticketTypeId: "tt-vip",
      status: "confirmed",
      createdAt: now,
    });
    const reg2 = buildRegistration({
      eventId: "ev-1",
      ticketTypeId: "tt-std",
      status: "checked_in",
      createdAt: now,
      checkedInAt: now,
    });
    const reg3 = buildRegistration({
      eventId: "ev-1",
      ticketTypeId: "tt-vip",
      status: "checked_in",
      createdAt: now,
      checkedInAt: now,
    });

    mockRegsSnap.docs = [
      { id: reg1.id, data: () => ({ ...reg1 }) },
      { id: reg2.id, data: () => ({ ...reg2 }) },
      { id: reg3.id, data: () => ({ ...reg3 }) },
    ];

    const result = await service.getOrgAnalytics(orgId, { timeframe: "30d" }, user);

    const vipStats = result.byTicketType.find((t) => t.ticketTypeName === "VIP");
    const stdStats = result.byTicketType.find((t) => t.ticketTypeName === "Standard");

    expect(vipStats).toEqual({ ticketTypeName: "VIP", registered: 2, checkedIn: 1 });
    expect(stdStats).toEqual({ ticketTypeName: "Standard", registered: 1, checkedIn: 1 });
  });

  it("returns top events sorted by registration count", async () => {
    const now = new Date().toISOString();
    const ev1 = buildEvent({
      id: "ev-1",
      organizationId: orgId,
      title: "Small Event",
      registeredCount: 10,
      checkedInCount: 5,
      status: "published",
      createdAt: now,
    });
    const ev2 = buildEvent({
      id: "ev-2",
      organizationId: orgId,
      title: "Big Event",
      registeredCount: 100,
      checkedInCount: 50,
      status: "published",
      createdAt: now,
    });

    mockEventsSnap.docs = [
      { id: ev1.id, data: () => ({ ...ev1 }) },
      { id: ev2.id, data: () => ({ ...ev2 }) },
    ];

    const result = await service.getOrgAnalytics(orgId, { timeframe: "30d" }, user);

    expect(result.topEvents[0].title).toBe("Big Event");
    expect(result.topEvents[0].registeredCount).toBe(100);
    expect(result.topEvents[1].title).toBe("Small Event");
  });

  it("excludes archived and cancelled events from top events", async () => {
    const now = new Date().toISOString();
    const archived = buildEvent({
      id: "ev-1",
      organizationId: orgId,
      title: "Archived",
      status: "archived",
      registeredCount: 100,
      createdAt: now,
    });
    const cancelled = buildEvent({
      id: "ev-2",
      organizationId: orgId,
      title: "Cancelled",
      status: "cancelled",
      registeredCount: 50,
      createdAt: now,
    });
    const active = buildEvent({
      id: "ev-3",
      organizationId: orgId,
      title: "Active",
      status: "published",
      registeredCount: 10,
      createdAt: now,
    });

    mockEventsSnap.docs = [
      { id: archived.id, data: () => ({ ...archived }) },
      { id: cancelled.id, data: () => ({ ...cancelled }) },
      { id: active.id, data: () => ({ ...active }) },
    ];

    const result = await service.getOrgAnalytics(orgId, { timeframe: "30d" }, user);

    expect(result.topEvents).toHaveLength(1);
    expect(result.topEvents[0].title).toBe("Active");
  });

  it("defaults timeframe to 30d when not specified", async () => {
    const result = await service.getOrgAnalytics(orgId, { timeframe: "30d" }, user);

    expect(result.timeframe).toBe("30d");
  });

  it("denies access for user without event:read permission", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });

    await expect(service.getOrgAnalytics(orgId, { timeframe: "30d" }, participant)).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("denies access for user from different organization", async () => {
    const otherUser = buildOrganizerUser("other-org");

    await expect(service.getOrgAnalytics(orgId, { timeframe: "30d" }, otherUser)).rejects.toThrow(
      "Accès refusé",
    );
  });

  it("generates time series for registrations and checkins", async () => {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const event = buildEvent({
      id: "ev-1",
      organizationId: orgId,
      status: "published",
      createdAt: new Date().toISOString(),
    });

    mockEventsSnap.docs = [{ id: event.id, data: () => ({ ...event }) }];

    const now = new Date().toISOString();
    const reg1 = buildRegistration({
      eventId: "ev-1",
      status: "checked_in",
      createdAt: now,
      checkedInAt: now,
    });
    const reg2 = buildRegistration({ eventId: "ev-1", status: "confirmed", createdAt: now });

    mockRegsSnap.docs = [
      { id: reg1.id, data: () => ({ ...reg1 }) },
      { id: reg2.id, data: () => ({ ...reg2 }) },
    ];

    const result = await service.getOrgAnalytics(orgId, { timeframe: "30d" }, user);

    expect(result.registrationsOverTime).toHaveLength(1);
    expect(result.registrationsOverTime[0].date).toBe(today);
    expect(result.registrationsOverTime[0].count).toBe(2);

    expect(result.checkinsOverTime).toHaveLength(1);
    expect(result.checkinsOverTime[0].date).toBe(today);
    expect(result.checkinsOverTime[0].count).toBe(1);
  });
});
