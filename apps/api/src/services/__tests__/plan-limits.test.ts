import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PLAN_LIMITS,
  PLAN_DISPLAY,
  type OrganizationPlan,
  type PlanFeature,
} from "@teranga/shared-types";
import { EventService } from "../event.service";
import { buildOrganizerUser, buildOrganization, buildEvent } from "@/__tests__/factories";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockEventRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findBySlug: vi.fn(),
  findPublished: vi.fn(),
  findByOrganization: vi.fn(),
  countActiveByOrganization: vi.fn(),
  search: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  softDelete: vi.fn(),
};

const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
};

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockOrgRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/repositories/venue.repository", () => ({
  venueRepository: {
    findByIdOrThrow: vi.fn(),
    increment: vi.fn(),
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

const mockTxUpdate = vi.fn();
const mockTxGet = vi.fn();
const mockDocRef = { id: "mock-doc" };

vi.mock("@/config/firebase", () => ({
  db: {
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { get: mockTxGet, update: mockTxUpdate };
      return fn(tx);
    }),
    collection: vi.fn(() => ({
      doc: vi.fn(() => mockDocRef),
    })),
  },
  COLLECTIONS: { EVENTS: "events" },
}));

// ─── Setup ──────────────────────────────────────────────────────────────────

const eventService = new EventService();

beforeEach(() => {
  vi.clearAllMocks();
  mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
});

// ─── PLAN_LIMITS Structure Validation ───────────────────────────────────────

describe("PLAN_LIMITS structure", () => {
  const plans: OrganizationPlan[] = ["free", "starter", "pro", "enterprise"];

  it("defines limits for all plan tiers", () => {
    for (const plan of plans) {
      expect(PLAN_LIMITS[plan]).toBeDefined();
      expect(typeof PLAN_LIMITS[plan].maxEvents).toBe("number");
      expect(typeof PLAN_LIMITS[plan].maxParticipantsPerEvent).toBe("number");
      expect(typeof PLAN_LIMITS[plan].maxMembers).toBe("number");
    }
  });

  it("every plan has a features object with all boolean flags", () => {
    const featureKeys: PlanFeature[] = [
      "qrScanning",
      "paidTickets",
      "customBadges",
      "csvExport",
      "smsNotifications",
      "advancedAnalytics",
      "speakerPortal",
      "sponsorPortal",
      "apiAccess",
      "whiteLabel",
      "promoCodes",
    ];

    for (const plan of plans) {
      const features = PLAN_LIMITS[plan].features;
      expect(features).toBeDefined();
      for (const key of featureKeys) {
        expect(typeof features[key]).toBe("boolean");
      }
    }
  });

  it("free plan has no features enabled", () => {
    const features = PLAN_LIMITS.free.features;
    const enabled = Object.values(features).filter(Boolean);
    expect(enabled).toHaveLength(0);
  });

  it("enterprise plan has all features enabled", () => {
    const features = PLAN_LIMITS.enterprise.features;
    const disabled = Object.values(features).filter((v) => !v);
    expect(disabled).toHaveLength(0);
  });

  it("each higher tier has >= limits of the tier below", () => {
    for (let i = 1; i < plans.length; i++) {
      const prev = PLAN_LIMITS[plans[i - 1]];
      const curr = PLAN_LIMITS[plans[i]];
      expect(curr.maxEvents).toBeGreaterThanOrEqual(prev.maxEvents);
      expect(curr.maxParticipantsPerEvent).toBeGreaterThanOrEqual(prev.maxParticipantsPerEvent);
      expect(curr.maxMembers).toBeGreaterThanOrEqual(prev.maxMembers);
    }
  });

  it("each higher tier enables >= features of the tier below", () => {
    for (let i = 1; i < plans.length; i++) {
      const prevFeatures = PLAN_LIMITS[plans[i - 1]].features;
      const currFeatures = PLAN_LIMITS[plans[i]].features;
      const prevCount = Object.values(prevFeatures).filter(Boolean).length;
      const currCount = Object.values(currFeatures).filter(Boolean).length;
      expect(currCount).toBeGreaterThanOrEqual(prevCount);
    }
  });

  it("pro and enterprise have unlimited events (Infinity)", () => {
    expect(PLAN_LIMITS.pro.maxEvents).toBe(Infinity);
    expect(PLAN_LIMITS.enterprise.maxEvents).toBe(Infinity);
  });

  it("enterprise has unlimited participants per event (Infinity)", () => {
    expect(PLAN_LIMITS.enterprise.maxParticipantsPerEvent).toBe(Infinity);
  });

  it("free plan has specific numeric limits", () => {
    expect(PLAN_LIMITS.free.maxEvents).toBe(3);
    expect(PLAN_LIMITS.free.maxParticipantsPerEvent).toBe(50);
    expect(PLAN_LIMITS.free.maxMembers).toBe(1);
  });
});

// ─── PLAN_DISPLAY Structure ─────────────────────────────────────────────────

describe("PLAN_DISPLAY structure", () => {
  const plans: OrganizationPlan[] = ["free", "starter", "pro", "enterprise"];

  it("has display info for every plan", () => {
    for (const plan of plans) {
      const display = PLAN_DISPLAY[plan];
      expect(display).toBeDefined();
      expect(display.id).toBe(plan);
      expect(display.name.fr).toBeTruthy();
      expect(display.name.en).toBeTruthy();
      expect(typeof display.priceXof).toBe("number");
      expect(display.limits).toBe(PLAN_LIMITS[plan]);
    }
  });

  it("free plan is 0 XOF", () => {
    expect(PLAN_DISPLAY.free.priceXof).toBe(0);
  });

  it("starter costs 9 900 XOF", () => {
    expect(PLAN_DISPLAY.starter.priceXof).toBe(9900);
  });

  it("pro costs 29 900 XOF", () => {
    expect(PLAN_DISPLAY.pro.priceXof).toBe(29900);
  });

  it("plans are priced in ascending order (excluding enterprise)", () => {
    expect(PLAN_DISPLAY.free.priceXof).toBeLessThan(PLAN_DISPLAY.starter.priceXof);
    expect(PLAN_DISPLAY.starter.priceXof).toBeLessThan(PLAN_DISPLAY.pro.priceXof);
  });
});

// ─── Feature Gating per Plan ────────────────────────────────────────────────

describe("Feature gating by plan tier", () => {
  it("starter enables qrScanning, customBadges, csvExport, promoCodes", () => {
    const f = PLAN_LIMITS.starter.features;
    expect(f.qrScanning).toBe(true);
    expect(f.customBadges).toBe(true);
    expect(f.csvExport).toBe(true);
    expect(f.promoCodes).toBe(true);
  });

  it("starter does NOT enable paidTickets, smsNotifications, advancedAnalytics", () => {
    const f = PLAN_LIMITS.starter.features;
    expect(f.paidTickets).toBe(false);
    expect(f.smsNotifications).toBe(false);
    expect(f.advancedAnalytics).toBe(false);
  });

  it("pro enables paidTickets, smsNotifications, advancedAnalytics, speakerPortal, sponsorPortal", () => {
    const f = PLAN_LIMITS.pro.features;
    expect(f.paidTickets).toBe(true);
    expect(f.smsNotifications).toBe(true);
    expect(f.advancedAnalytics).toBe(true);
    expect(f.speakerPortal).toBe(true);
    expect(f.sponsorPortal).toBe(true);
  });

  it("pro does NOT enable apiAccess and whiteLabel", () => {
    const f = PLAN_LIMITS.pro.features;
    expect(f.apiAccess).toBe(false);
    expect(f.whiteLabel).toBe(false);
  });

  it("only enterprise enables apiAccess and whiteLabel", () => {
    expect(PLAN_LIMITS.enterprise.features.apiAccess).toBe(true);
    expect(PLAN_LIMITS.enterprise.features.whiteLabel).toBe(true);
    expect(PLAN_LIMITS.pro.features.apiAccess).toBe(false);
    expect(PLAN_LIMITS.starter.features.apiAccess).toBe(false);
    expect(PLAN_LIMITS.free.features.apiAccess).toBe(false);
  });
});

// ─── Event Creation Plan Limit Enforcement ──────────────────────────────────

describe("Event creation plan limit enforcement", () => {
  const makeDto = () => ({
    organizationId: "org-1",
    title: "Test Event",
    description: "Test",
    category: "conference" as const,
    format: "in_person" as const,
    status: "draft" as const,
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
  });

  it("rejects event creation when free plan at max events limit", async () => {
    const freeOrg = buildOrganization({ id: "org-1", plan: "free" });
    const user = buildOrganizerUser("org-1");

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(freeOrg);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(3); // free limit is 3

    await expect(eventService.create(makeDto(), user)).rejects.toThrow("Limite du plan");
  });

  it("allows event creation when free plan below limit", async () => {
    const freeOrg = buildOrganization({ id: "org-1", plan: "free" });
    const user = buildOrganizerUser("org-1");

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(freeOrg);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(2); // below free limit of 3
    mockEventRepo.create.mockResolvedValue(buildEvent({ title: "Test Event" }));

    const result = await eventService.create(makeDto(), user);
    expect(result.title).toBe("Test Event");
  });

  it("allows event creation on pro plan (unlimited events)", async () => {
    const proOrg = buildOrganization({ id: "org-1", plan: "pro" });
    const user = buildOrganizerUser("org-1");

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(proOrg);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(100); // many events, no limit
    mockEventRepo.create.mockResolvedValue(buildEvent({ title: "Pro Event" }));

    const result = await eventService.create(makeDto(), user);
    expect(result.title).toBe("Pro Event");
  });

  it("rejects starter plan at 10 events", async () => {
    const starterOrg = buildOrganization({ id: "org-1", plan: "starter" });
    const user = buildOrganizerUser("org-1");

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(starterOrg);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(10); // starter limit

    await expect(eventService.create(makeDto(), user)).rejects.toThrow("Limite du plan");
  });

  it("allows starter plan at 9 events", async () => {
    const starterOrg = buildOrganization({ id: "org-1", plan: "starter" });
    const user = buildOrganizerUser("org-1");

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(starterOrg);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(9);
    mockEventRepo.create.mockResolvedValue(buildEvent({ title: "Starter Event" }));

    const result = await eventService.create(makeDto(), user);
    expect(result.title).toBe("Starter Event");
  });
});

// ─── Paid Tickets Feature Gate ──────────────────────────────────────────────

describe("Paid ticket feature gating", () => {
  it("rejects paid ticket on free plan", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft", ticketTypes: [] });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrganization({ id: "org-1", plan: "free" }));

    await expect(
      eventService.addTicketType(
        event.id,
        {
          name: "VIP",
          price: 5000,
          currency: "XOF",
          totalQuantity: 50,
          accessZoneIds: [],
          isVisible: true,
        },
        user,
      ),
    ).rejects.toThrow("paidTickets");
  });

  it("rejects paid ticket on starter plan", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft", ticketTypes: [] });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({ id: "org-1", plan: "starter" }),
    );

    await expect(
      eventService.addTicketType(
        event.id,
        {
          name: "VIP",
          price: 10000,
          currency: "XOF",
          totalQuantity: 20,
          accessZoneIds: [],
          isVisible: true,
        },
        user,
      ),
    ).rejects.toThrow("paidTickets");
  });

  it("allows paid ticket on pro plan", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft", ticketTypes: [] });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrganization({ id: "org-1", plan: "pro" }));

    const result = await eventService.addTicketType(
      event.id,
      {
        name: "VIP",
        price: 5000,
        currency: "XOF",
        totalQuantity: 50,
        accessZoneIds: [],
        isVisible: true,
      },
      user,
    );

    expect(result.ticketTypes).toHaveLength(1);
    expect(result.ticketTypes[0].price).toBe(5000);
  });

  it("allows free ticket on any plan (no feature check needed)", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft", ticketTypes: [] });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    // No orgRepo mock needed — free tickets bypass feature check

    const result = await eventService.addTicketType(
      event.id,
      {
        name: "Standard",
        price: 0,
        currency: "XOF",
        totalQuantity: 100,
        accessZoneIds: [],
        isVisible: true,
      },
      user,
    );

    expect(result.ticketTypes).toHaveLength(1);
    expect(result.ticketTypes[0].price).toBe(0);
  });
});

// ─── Clone Enforcement ──────────────────────────────────────────────────────

describe("Clone plan limit enforcement", () => {
  it("rejects clone when free plan at event limit", async () => {
    const freeOrg = buildOrganization({ id: "org-1", plan: "free" });
    const user = buildOrganizerUser("org-1");
    const source = buildEvent({ organizationId: "org-1" });

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(freeOrg);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(3); // at free limit

    await expect(
      eventService.clone(
        source.id,
        {
          newStartDate: new Date(Date.now() + 86400000).toISOString(),
          newEndDate: new Date(Date.now() + 2 * 86400000).toISOString(),
          copyTicketTypes: true,
          copyAccessZones: true,
        },
        user,
      ),
    ).rejects.toThrow("Limite du plan");
  });

  it("allows clone when enterprise plan (unlimited)", async () => {
    const entOrg = buildOrganization({ id: "org-1", plan: "enterprise" });
    const user = buildOrganizerUser("org-1");
    const source = buildEvent({ organizationId: "org-1", title: "Original" });

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(entOrg);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(source);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(999);
    mockEventRepo.create.mockResolvedValue(buildEvent({ title: "Original (copie)" }));

    const result = await eventService.clone(
      source.id,
      {
        newStartDate: new Date(Date.now() + 86400000).toISOString(),
        newEndDate: new Date(Date.now() + 2 * 86400000).toISOString(),
        copyTicketTypes: true,
        copyAccessZones: true,
      },
      user,
    );

    expect(result).toBeDefined();
  });
});
