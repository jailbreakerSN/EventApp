import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PLAN_LIMITS,
  PLAN_DISPLAY,
  type OrganizationPlan,
  type PlanFeature,
} from "@teranga/shared-types";
import { EventService } from "../event.service";
import {
  buildOrganizerUser,
  buildOrganization,
  buildOrgWithPlan,
  buildEvent,
} from "@/__tests__/factories";

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

  it("rejects raising an existing free ticket to a paid price on free plan", async () => {
    const user = buildOrganizerUser("org-1");
    const existing = {
      id: "tt-1",
      name: "Standard",
      price: 0,
      currency: "XOF" as const,
      totalQuantity: 100,
      soldCount: 0,
      accessZoneIds: [],
      isVisible: true,
    };
    const event = buildEvent({
      organizationId: "org-1",
      status: "draft",
      ticketTypes: [existing],
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrganization({ id: "org-1", plan: "free" }));

    await expect(
      eventService.updateTicketType(event.id, "tt-1", { price: 5000 }, user),
    ).rejects.toThrow("paidTickets");
  });

  it("rejects editing any field of an existing paid ticket on starter plan", async () => {
    const user = buildOrganizerUser("org-1");
    const existing = {
      id: "tt-1",
      name: "VIP",
      price: 10000,
      currency: "XOF" as const,
      totalQuantity: 50,
      soldCount: 0,
      accessZoneIds: [],
      isVisible: true,
    };
    const event = buildEvent({
      organizationId: "org-1",
      status: "draft",
      ticketTypes: [existing],
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({ id: "org-1", plan: "starter" }),
    );

    // Price unchanged, but the resulting merged ticket still has price > 0,
    // so starter (no paidTickets) must be refused.
    await expect(
      eventService.updateTicketType(event.id, "tt-1", { name: "VIP Plus" }, user),
    ).rejects.toThrow("paidTickets");
  });

  it("allows lowering an existing paid ticket to a free price on free plan", async () => {
    const user = buildOrganizerUser("org-1");
    const existing = {
      id: "tt-1",
      name: "VIP",
      price: 5000,
      currency: "XOF" as const,
      totalQuantity: 50,
      soldCount: 0,
      accessZoneIds: [],
      isVisible: true,
    };
    const event = buildEvent({
      organizationId: "org-1",
      status: "draft",
      ticketTypes: [existing],
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    // No orgRepo mock — free merged price bypasses the feature check.

    const result = await eventService.updateTicketType(
      event.id,
      "tt-1",
      { price: 0 },
      user,
    );

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

// ─── Phase 3: Enforcement cutover (effective fields) ─────────────────────
// Verify enforcement now reads `org.effectiveLimits`/`effectiveFeatures` when
// present, and still falls back to the hardcoded PLAN_LIMITS otherwise.

describe("Phase 3 — enforcement reads org.effectiveLimits first", () => {
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

  it("behaves identically on the fallback path vs the effective-fields path (parity)", async () => {
    const user = buildOrganizerUser("org-1");

    // Path A: legacy org (no effective fields) — hits PLAN_LIMITS fallback
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({ id: "org-1", plan: "starter" }),
    );
    mockEventRepo.countActiveByOrganization.mockResolvedValue(10); // starter limit
    await expect(eventService.create(makeDto(), user)).rejects.toThrow("Limite du plan");

    // Path B: same plan but with effectiveLimits populated — same result
    vi.clearAllMocks();
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(buildOrgWithPlan("starter", { id: "org-1" }));
    mockEventRepo.countActiveByOrganization.mockResolvedValue(10);
    await expect(eventService.create(makeDto(), user)).rejects.toThrow("Limite du plan");
  });

  it("honors an effectiveLimits override that raises maxEvents above the tier", async () => {
    const user = buildOrganizerUser("org-1");
    // Starter's base maxEvents is 10. Override bumps it to 999 — org should be
    // able to create a 15th event where the base plan would refuse.
    const boosted = buildOrgWithPlan("starter", {
      id: "org-1",
      effectiveLimits: {
        maxEvents: 999,
        maxParticipantsPerEvent: 200,
        maxMembers: 3,
      },
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(boosted);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(15);
    mockEventRepo.create.mockResolvedValue(buildEvent({ title: "Boosted" }));

    const result = await eventService.create(makeDto(), user);
    expect(result.title).toBe("Boosted");
  });

  it("honors an effectiveLimits override that lowers maxEvents below the tier", async () => {
    const user = buildOrganizerUser("org-1");
    // Pro's base maxEvents is Infinity. A downgrading override caps it at 5.
    const capped = buildOrgWithPlan("pro", {
      id: "org-1",
      effectiveLimits: {
        maxEvents: 5,
        maxParticipantsPerEvent: 2000,
        maxMembers: 50,
      },
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(capped);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(5);

    await expect(eventService.create(makeDto(), user)).rejects.toThrow("Limite du plan");
  });

  it("honors -1 (unlimited) in the stored effectiveLimits", async () => {
    const user = buildOrganizerUser("org-1");
    // Explicit -1 representation (how enterprise looks on disk).
    const ent = buildOrgWithPlan("enterprise", { id: "org-1" });
    expect(ent.effectiveLimits?.maxEvents).toBe(-1); // sanity
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(ent);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(50000);
    mockEventRepo.create.mockResolvedValue(buildEvent({ title: "Enterprise" }));

    const result = await eventService.create(makeDto(), user);
    expect(result.title).toBe("Enterprise");
  });

  it("honors effectiveFeatures override — paid tickets gated despite starter base", async () => {
    // Starter normally has paidTickets=false. Override flips it true.
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft", ticketTypes: [] });
    const orgWithPaidTickets = buildOrgWithPlan("starter", {
      id: "org-1",
      effectiveFeatures: {
        ...buildOrgWithPlan("starter").effectiveFeatures!,
        paidTickets: true,
      },
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(orgWithPaidTickets);

    await expect(
      eventService.addTicketType(
        event.id,
        {
          name: "VIP",
          price: 10000,
          currency: "XOF",
          totalQuantity: 10,
          accessZoneIds: [],
          isVisible: true,
        },
        user,
      ),
    ).resolves.toBeDefined();
  });

  it("blocks a paid ticket when effectiveFeatures.paidTickets is false (even on pro)", async () => {
    // Pro normally has paidTickets=true. Override flips it false — should block.
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ organizationId: "org-1", status: "draft", ticketTypes: [] });
    const orgProNoPaid = buildOrgWithPlan("pro", {
      id: "org-1",
      effectiveFeatures: {
        ...buildOrgWithPlan("pro").effectiveFeatures!,
        paidTickets: false,
      },
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      id: event.id,
      data: () => ({ ...event, id: undefined }),
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(orgProNoPaid);

    await expect(
      eventService.addTicketType(
        event.id,
        {
          name: "VIP",
          price: 10000,
          currency: "XOF",
          totalQuantity: 10,
          accessZoneIds: [],
          isVisible: true,
        },
        user,
      ),
    ).rejects.toThrow("paidTickets");
  });

  it("error message surfaces effectivePlanKey when the override renames the plan", async () => {
    const user = buildOrganizerUser("org-1");
    // Custom plan — effectivePlanKey is not one of the OrganizationPlan enum
    const org = buildOrgWithPlan("starter", {
      id: "org-1",
      effectivePlanKey: "custom_acme_2026",
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(10); // starter baseline hit

    await expect(eventService.create(makeDto(), user)).rejects.toThrow("custom_acme_2026");
  });
});
