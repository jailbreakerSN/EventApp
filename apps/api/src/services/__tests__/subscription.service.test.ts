import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildSuperAdmin,
  buildOrganization,
} from "@/__tests__/factories";
// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockSubRepo = {
  findByOrganization: vi.fn(),
  findByIdOrThrow: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
  update: vi.fn(),
};

const mockEventRepo = {
  countActiveByOrganization: vi.fn(),
};

vi.mock("@/repositories/subscription.repository", () => ({
  subscriptionRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockSubRepo as Record<string, unknown>)[prop as string],
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

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

// ── Plan repository mock ──────────────────────────────────────────────────
// Default: catalog lookup returns null. This matches the pre-Phase-2 behavior
// and leaves the existing test assertions (strict `{ plan: "x" }` matches)
// untouched. Phase 2 denormalization tests override this per-case.
const mockPlanRepo = {
  findByKey: vi.fn().mockResolvedValue(null),
  findByIdOrThrow: vi.fn(),
  // Phase 7+ item #4 (trials): `upgrade()` reads trialDays off the resolved
  // catalog plan via findById. Default to null so upgrade tests that don't
  // care about trials see the same behaviour they had pre-#4.
  findById: vi.fn().mockResolvedValue(null),
};

vi.mock("@/repositories/plan.repository", () => ({
  planRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockPlanRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
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
  COLLECTIONS: {
    ORGANIZATIONS: "organizations",
    SUBSCRIPTIONS: "subscriptions",
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Import AFTER mocks
import { SubscriptionService } from "../subscription.service";
import { eventBus } from "@/events/event-bus";

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new SubscriptionService();

beforeEach(() => {
  vi.clearAllMocks();
  // Default: plan catalog lookup returns null → resolveEffectiveForOrg yields
  // null → upgrade/downgrade tx write contains only { plan } (matches legacy
  // strict assertions). Phase 2 tests below override per-case.
  mockPlanRepo.findByKey.mockResolvedValue(null);
});

// ── Permission denial ────────────────────────────────────────────────────

describe("SubscriptionService — permission denial", () => {
  const participant = buildAuthUser({ roles: ["participant"] });

  it("rejects getSubscription for non-organizer", async () => {
    await expect(service.getSubscription("org-1", participant)).rejects.toThrow(
      "Permission manquante : organization:manage_billing",
    );
  });

  it("rejects upgrade for non-organizer", async () => {
    await expect(service.upgrade("org-1", { plan: "starter" }, participant)).rejects.toThrow(
      "Permission manquante : organization:manage_billing",
    );
  });

  it("rejects downgrade for non-organizer", async () => {
    await expect(service.downgrade("org-1", "free", participant)).rejects.toThrow(
      "Permission manquante : organization:manage_billing",
    );
  });

  it("rejects cancel for non-organizer", async () => {
    await expect(service.cancel("org-1", participant)).rejects.toThrow(
      "Permission manquante : organization:manage_billing",
    );
  });
});

// ── Organization access denial ───────────────────────────────────────────

describe("SubscriptionService — org access denial", () => {
  const user = buildOrganizerUser("org-other");

  it("rejects getSubscription for wrong org", async () => {
    await expect(service.getSubscription("org-1", user)).rejects.toThrow(
      "Accès refusé aux ressources de cette organisation",
    );
  });

  it("rejects getUsage for wrong org", async () => {
    await expect(service.getUsage("org-1", user)).rejects.toThrow(
      "Accès refusé aux ressources de cette organisation",
    );
  });

  it("rejects upgrade for wrong org", async () => {
    await expect(service.upgrade("org-1", { plan: "starter" }, user)).rejects.toThrow(
      "Accès refusé aux ressources de cette organisation",
    );
  });

  it("rejects downgrade for wrong org", async () => {
    await expect(service.downgrade("org-1", "free", user)).rejects.toThrow(
      "Accès refusé aux ressources de cette organisation",
    );
  });
});

// ── getSubscription ──────────────────────────────────────────────────────

describe("SubscriptionService.getSubscription", () => {
  it("returns subscription for the organization", async () => {
    const user = buildOrganizerUser("org-1");
    const sub = { id: "sub-1", organizationId: "org-1", plan: "starter", status: "active" };
    mockSubRepo.findByOrganization.mockResolvedValue(sub);

    const result = await service.getSubscription("org-1", user);

    expect(result).toEqual(sub);
    expect(mockSubRepo.findByOrganization).toHaveBeenCalledWith("org-1");
  });

  it("returns null for free plan (no subscription doc)", async () => {
    const user = buildOrganizerUser("org-1");
    mockSubRepo.findByOrganization.mockResolvedValue(null);

    const result = await service.getSubscription("org-1", user);
    expect(result).toBeNull();
  });
});

// ── getUsage ─────────────────────────────────────────────────────────────

describe("SubscriptionService.getUsage", () => {
  it("computes correct usage values for free plan", async () => {
    const user = buildOrganizerUser("org-1");
    const org = buildOrganization({ id: "org-1", plan: "free", memberIds: ["user-1"] });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(2);

    const result = await service.getUsage("org-1", user);

    expect(result.plan).toBe("free");
    expect(result.events.current).toBe(2);
    expect(result.events.limit).toBe(3);
    expect(result.members.current).toBe(1);
    expect(result.members.limit).toBe(1);
    expect(result.features).toBeDefined();
  });

  it("computes correct usage values for starter plan", async () => {
    const user = buildOrganizerUser("org-1");
    const org = buildOrganization({
      id: "org-1",
      plan: "starter",
      memberIds: ["user-1", "user-2"],
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(5);

    const result = await service.getUsage("org-1", user);

    expect(result.plan).toBe("starter");
    expect(result.events.current).toBe(5);
    expect(result.events.limit).toBe(10);
    expect(result.members.current).toBe(2);
    expect(result.members.limit).toBe(3);
  });

  it("handles org with no memberIds gracefully", async () => {
    const user = buildOrganizerUser("org-1");
    const org = buildOrganization({ id: "org-1", plan: "free" });
    // Factory defaults memberIds to [], simulate missing field
    (org as Record<string, unknown>).memberIds = undefined;
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);

    const result = await service.getUsage("org-1", user);

    expect(result.members.current).toBe(0);
  });
});

// ── upgrade ──────────────────────────────────────────────────────────────

describe("SubscriptionService.upgrade", () => {
  it("upgrades from free to starter (no existing subscription)", async () => {
    const user = buildOrganizerUser("org-1");

    // Transaction mock: org is on free plan
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "free", memberIds: ["user-1"] }),
    });

    // No existing subscription
    mockSubRepo.findByOrganization.mockResolvedValue(null);

    const createdSub = {
      id: "sub-new",
      organizationId: "org-1",
      plan: "starter",
      status: "active",
    };
    mockSubRepo.create.mockResolvedValue(createdSub);

    const result = await service.upgrade("org-1", { plan: "starter" }, user);

    expect(result.plan).toBe("starter");
    expect(mockTxUpdate).toHaveBeenCalledWith(mockDocRef, { plan: "starter" });
    expect(mockSubRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        plan: "starter",
        status: "active",
      }),
    );
  });

  it("upgrades from starter to pro (existing subscription)", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "starter", memberIds: ["user-1"] }),
    });

    const existingSub = {
      id: "sub-existing",
      organizationId: "org-1",
      plan: "starter",
      status: "active",
    };
    mockSubRepo.findByOrganization.mockResolvedValue(existingSub);
    mockSubRepo.update.mockResolvedValue(undefined);

    const updatedSub = {
      id: "sub-existing",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
    };
    mockSubRepo.findByIdOrThrow.mockResolvedValue(updatedSub);

    const result = await service.upgrade("org-1", { plan: "pro" }, user);

    expect(result.plan).toBe("pro");
    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-existing",
      expect.objectContaining({ plan: "pro", status: "active" }),
    );
  });

  it("rejects invalid upgrade path (pro to starter)", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "pro", memberIds: ["user-1"] }),
    });

    await expect(service.upgrade("org-1", { plan: "starter" }, user)).rejects.toThrow(
      "Impossible de passer du plan pro au plan starter",
    );
  });

  it("rejects upgrade from enterprise (no valid targets)", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "enterprise", memberIds: [] }),
    });

    await expect(service.upgrade("org-1", { plan: "pro" }, user)).rejects.toThrow(
      "Impossible de passer du plan enterprise au plan pro",
    );
  });

  it("emits subscription.upgraded domain event", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "free", memberIds: [] }),
    });
    mockSubRepo.findByOrganization.mockResolvedValue(null);
    mockSubRepo.create.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "starter",
      status: "active",
    });

    await service.upgrade("org-1", { plan: "starter" }, user);

    expect(eventBus.emit).toHaveBeenCalledWith(
      "subscription.upgraded",
      expect.objectContaining({
        organizationId: "org-1",
        previousPlan: "free",
        newPlan: "starter",
        actorId: user.uid,
      }),
    );
  });
});

// ── downgrade ────────────────────────────────────────────────────────────

describe("SubscriptionService.downgrade", () => {
  it("downgrades from starter to free when usage fits", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "starter", memberIds: ["user-1"] }),
    });
    mockEventRepo.countActiveByOrganization.mockResolvedValue(2);

    const existingSub = { id: "sub-1", organizationId: "org-1", plan: "starter" };
    mockSubRepo.findByOrganization.mockResolvedValue(existingSub);
    mockSubRepo.update.mockResolvedValue(undefined);

    await expect(service.downgrade("org-1", "free", user)).resolves.not.toThrow();

    expect(mockTxUpdate).toHaveBeenCalledWith(mockDocRef, { plan: "free" });
    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ status: "cancelled", plan: "free" }),
    );
  });

  it("rejects downgrade when member count exceeds target limit", async () => {
    const user = buildOrganizerUser("org-1");

    // Starter maxMembers = 3, but org has 10 members — can't go to starter
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        plan: "pro",
        memberIds: Array.from({ length: 10 }, (_, i) => `user-${i}`),
      }),
    });

    await expect(service.downgrade("org-1", "starter", user)).rejects.toThrow(
      "Limite du plan atteinte",
    );
  });

  it("rejects downgrade when event count exceeds target limit", async () => {
    const user = buildOrganizerUser("org-1");

    // Transaction passes (member count OK), but event count exceeds free limit (3)
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "starter", memberIds: ["user-1"] }),
    });
    mockEventRepo.countActiveByOrganization.mockResolvedValue(5);

    await expect(service.downgrade("org-1", "free", user)).rejects.toThrow(
      "Limite du plan atteinte",
    );

    // Should rollback the plan change
    expect(mockOrgRepo.update).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ plan: "starter" }),
    );
  });

  it("rejects invalid downgrade path (free to starter)", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "free", memberIds: [] }),
    });

    await expect(service.downgrade("org-1", "starter", user)).rejects.toThrow(
      "Impossible de passer du plan free au plan starter",
    );
  });

  it("emits subscription.downgraded domain event", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "starter", memberIds: ["user-1"] }),
    });
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "starter",
    });
    mockSubRepo.update.mockResolvedValue(undefined);

    await service.downgrade("org-1", "free", user);

    expect(eventBus.emit).toHaveBeenCalledWith(
      "subscription.downgraded",
      expect.objectContaining({
        organizationId: "org-1",
        previousPlan: "starter",
        newPlan: "free",
        actorId: user.uid,
      }),
    );
  });

  it("updates subscription to cancelled status when downgrading to free", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "pro", memberIds: ["user-1"] }),
    });
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);

    const existingSub = { id: "sub-1", organizationId: "org-1", plan: "pro" };
    mockSubRepo.findByOrganization.mockResolvedValue(existingSub);
    mockSubRepo.update.mockResolvedValue(undefined);

    await service.downgrade("org-1", "free", user);

    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({
        status: "cancelled",
        plan: "free",
        cancelledAt: expect.any(String),
      }),
    );
  });

  it("updates subscription price when downgrading to non-free plan", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "pro", memberIds: ["user-1", "user-2"] }),
    });
    mockEventRepo.countActiveByOrganization.mockResolvedValue(5);

    const existingSub = { id: "sub-1", organizationId: "org-1", plan: "pro" };
    mockSubRepo.findByOrganization.mockResolvedValue(existingSub);
    mockSubRepo.update.mockResolvedValue(undefined);

    await service.downgrade("org-1", "starter", user);

    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({
        plan: "starter",
        priceXof: 9900,
      }),
    );
  });
});

// ── cancel ───────────────────────────────────────────────────────────────

describe("SubscriptionService.cancel", () => {
  it("reverts to free plan (delegates to downgrade)", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "starter", memberIds: ["user-1"] }),
    });
    mockEventRepo.countActiveByOrganization.mockResolvedValue(1);

    const existingSub = { id: "sub-1", organizationId: "org-1", plan: "starter" };
    mockSubRepo.findByOrganization.mockResolvedValue(existingSub);
    mockSubRepo.update.mockResolvedValue(undefined);

    await expect(service.cancel("org-1", user)).resolves.not.toThrow();

    expect(mockTxUpdate).toHaveBeenCalledWith(mockDocRef, { plan: "free" });
  });
});

// ── Super admin bypass ───────────────────────────────────────────────────

describe("SubscriptionService — super_admin bypass", () => {
  it("super_admin can access subscription of any org", async () => {
    const admin = buildSuperAdmin();
    mockSubRepo.findByOrganization.mockResolvedValue(null);

    const result = await service.getSubscription("any-org", admin);
    expect(result).toBeNull();
  });

  it("super_admin can view usage of any org", async () => {
    const admin = buildSuperAdmin();
    const org = buildOrganization({ id: "any-org", plan: "pro", memberIds: ["u1", "u2"] });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockEventRepo.countActiveByOrganization.mockResolvedValue(3);

    const result = await service.getUsage("any-org", admin);

    expect(result.plan).toBe("pro");
    expect(result.events.current).toBe(3);
  });

  it("super_admin can upgrade any org", async () => {
    const admin = buildSuperAdmin();

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "free", memberIds: [] }),
    });
    mockSubRepo.findByOrganization.mockResolvedValue(null);
    mockSubRepo.create.mockResolvedValue({
      id: "sub-new",
      organizationId: "any-org",
      plan: "pro",
      status: "active",
    });

    const result = await service.upgrade("any-org", { plan: "pro" }, admin);
    expect(result.plan).toBe("pro");
  });
});

// ── Phase 2: effective-plan denormalization ───────────────────────────────

function buildCatalogPlan(key: string) {
  const now = new Date().toISOString();
  return {
    id: `plan-${key}`,
    key,
    name: { fr: key, en: key },
    description: null,
    pricingModel: "fixed" as const,
    priceXof: key === "pro" ? 29900 : 9900,
    currency: "XOF" as const,
    limits:
      key === "pro"
        ? { maxEvents: -1, maxParticipantsPerEvent: 2000, maxMembers: 50 }
        : { maxEvents: 10, maxParticipantsPerEvent: 200, maxMembers: 3 },
    features: {
      qrScanning: true,
      paidTickets: key === "pro",
      customBadges: true,
      csvExport: true,
      smsNotifications: key === "pro",
      advancedAnalytics: key === "pro",
      speakerPortal: key === "pro",
      sponsorPortal: key === "pro",
      apiAccess: false,
      whiteLabel: false,
      promoCodes: true,
    },
    isSystem: true,
    isPublic: true,
    isArchived: false,
    sortOrder: 1,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("SubscriptionService — Phase 2 denormalization", () => {
  it("writes effectiveLimits/Features/PlanKey onto the org in the upgrade tx", async () => {
    const user = buildOrganizerUser("org-1");
    const pro = buildCatalogPlan("pro");
    mockPlanRepo.findByKey.mockResolvedValue(pro);

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "starter", memberIds: ["u1"] }),
    });
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "starter",
    });
    mockSubRepo.update.mockResolvedValue(undefined);
    mockSubRepo.findByIdOrThrow.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
    });

    await service.upgrade("org-1", { plan: "pro" }, user);

    expect(mockPlanRepo.findByKey).toHaveBeenCalledWith("pro");
    const txArg = mockTxUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(txArg.plan).toBe("pro");
    expect(txArg.effectivePlanKey).toBe("pro");
    // Stored shape: -1 survives, Infinity is never persisted
    expect(txArg.effectiveLimits).toMatchObject({
      maxEvents: -1,
      maxParticipantsPerEvent: 2000,
      maxMembers: 50,
    });
    expect((txArg.effectiveFeatures as Record<string, boolean>).paidTickets).toBe(true);
    expect(txArg.effectiveComputedAt).toEqual(expect.any(String));
  });

  it("writes planId onto the subscription doc during upgrade", async () => {
    const user = buildOrganizerUser("org-1");
    mockPlanRepo.findByKey.mockResolvedValue(buildCatalogPlan("pro"));

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "starter", memberIds: ["u1"] }),
    });
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "starter",
    });
    mockSubRepo.update.mockResolvedValue(undefined);
    mockSubRepo.findByIdOrThrow.mockResolvedValue({ id: "sub-1", plan: "pro" });

    await service.upgrade("org-1", { plan: "pro" }, user);

    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ plan: "pro", planId: "plan-pro" }),
    );
  });

  it("layers subscription.overrides on top of the base plan", async () => {
    const user = buildOrganizerUser("org-1");
    mockPlanRepo.findByKey.mockResolvedValue(buildCatalogPlan("starter"));

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "free", memberIds: [] }),
    });
    // Existing subscription carries a +50 maxEvents override
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "free",
      overrides: { limits: { maxEvents: 999 } },
    });
    mockSubRepo.update.mockResolvedValue(undefined);
    mockSubRepo.findByIdOrThrow.mockResolvedValue({ id: "sub-1", plan: "starter" });

    await service.upgrade("org-1", { plan: "starter" }, user);

    const txArg = mockTxUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect((txArg.effectiveLimits as { maxEvents: number }).maxEvents).toBe(999);
    // Non-overridden limit from the base plan still present
    expect((txArg.effectiveLimits as { maxMembers: number }).maxMembers).toBe(3);
  });

  it("skips denormalization when the catalog lookup returns null (graceful)", async () => {
    const user = buildOrganizerUser("org-1");
    mockPlanRepo.findByKey.mockResolvedValue(null);

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "free", memberIds: [] }),
    });
    mockSubRepo.findByOrganization.mockResolvedValue(null);
    mockSubRepo.create.mockResolvedValue({ id: "sub-x", plan: "starter", status: "active" });

    await service.upgrade("org-1", { plan: "starter" }, user);

    // Legacy strict shape: only the plan field is written
    expect(mockTxUpdate).toHaveBeenCalledWith(mockDocRef, { plan: "starter" });
  });

  it("writes effective fields on downgrade", async () => {
    const user = buildOrganizerUser("org-1");
    mockPlanRepo.findByKey.mockResolvedValue(buildCatalogPlan("starter"));

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "pro", memberIds: ["u1"] }),
    });
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    mockSubRepo.findByOrganization.mockResolvedValue({ id: "sub-1", plan: "pro" });
    mockSubRepo.update.mockResolvedValue(undefined);

    await service.downgrade("org-1", "starter", user);

    const txArg = mockTxUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(txArg.plan).toBe("starter");
    expect(txArg.effectivePlanKey).toBe("starter");
  });
});

describe("SubscriptionService.resolveEffectiveForOrg", () => {
  it("returns null when the plan key is not in the catalog", async () => {
    mockPlanRepo.findByKey.mockResolvedValue(null);
    const result = await service.resolveEffectiveForOrg("pro");
    expect(result).toBeNull();
  });

  it("returns the resolved effective plan for a catalog hit", async () => {
    mockPlanRepo.findByKey.mockResolvedValue(buildCatalogPlan("pro"));
    const result = await service.resolveEffectiveForOrg("pro");
    expect(result?.planKey).toBe("pro");
    expect(result?.limits.maxEvents).toBe(Infinity); // runtime form
  });
});

// ── Phase 4c: prepaid period honoring ─────────────────────────────────────

describe("SubscriptionService — Phase 4c scheduled downgrade", () => {
  const inFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const inPast = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  it("SCHEDULES a downgrade when a paid period is still in force (no tx write)", async () => {
    const user = buildOrganizerUser("org-1");

    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      currentPeriodEnd: inFuture,
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({ id: "org-1", plan: "pro", memberIds: ["u1"] }),
    );
    mockSubRepo.update.mockResolvedValue(undefined);

    const result = await service.downgrade("org-1", "starter", user);

    expect(result).toEqual({ scheduled: true, effectiveAt: inFuture });
    // No org/tx flip on the scheduled path
    expect(mockTxUpdate).not.toHaveBeenCalled();
    // Scheduled change persisted on the subscription doc
    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({
        scheduledChange: expect.objectContaining({
          toPlan: "starter",
          effectiveAt: inFuture,
          reason: "downgrade",
          scheduledBy: user.uid,
        }),
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      "subscription.change_scheduled",
      expect.objectContaining({
        organizationId: "org-1",
        fromPlan: "pro",
        toPlan: "starter",
        effectiveAt: inFuture,
        reason: "downgrade",
      }),
    );
  });

  it("FLIPS IMMEDIATELY when currentPeriodEnd is in the past", async () => {
    const user = buildOrganizerUser("org-1");

    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      currentPeriodEnd: inPast,
    });
    // Fall-through: transactional immediate path
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "pro", memberIds: ["u1"] }),
    });
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    mockSubRepo.update.mockResolvedValue(undefined);

    const result = await service.downgrade("org-1", "starter", user);

    expect(result).toEqual({ scheduled: false });
    expect(mockTxUpdate).toHaveBeenCalled(); // immediate tx write happened
  });

  it("FLIPS IMMEDIATELY when the org is already free (no paid rights to honor)", async () => {
    const user = buildOrganizerUser("org-1");
    mockSubRepo.findByOrganization.mockResolvedValue(null); // free org, no sub
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "starter", memberIds: [] }),
    });
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    mockSubRepo.update.mockResolvedValue(undefined);

    const result = await service.downgrade("org-1", "free", user);
    expect(result).toEqual({ scheduled: false });
  });

  it("FLIPS IMMEDIATELY when caller passes { immediate: true } AND has subscription:override", async () => {
    const admin = buildSuperAdmin(); // super_admin has all perms incl. subscription:override

    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      currentPeriodEnd: inFuture, // paid period still in force
    });
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "pro", memberIds: ["u1"] }),
    });
    mockEventRepo.countActiveByOrganization.mockResolvedValue(0);
    mockSubRepo.update.mockResolvedValue(undefined);

    const result = await service.downgrade("org-1", "starter", admin, { immediate: true });

    expect(result).toEqual({ scheduled: false });
    expect(mockTxUpdate).toHaveBeenCalled(); // immediate path taken despite paid period
  });

  it("rejects { immediate: true } when caller lacks subscription:override", async () => {
    const user = buildOrganizerUser("org-1"); // organizer has manage_billing but NOT subscription:override

    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      currentPeriodEnd: inFuture,
    });

    await expect(service.downgrade("org-1", "starter", user, { immediate: true })).rejects.toThrow(
      "Permission manquante : subscription:override",
    );
  });

  it("rejects scheduled downgrade when member count would exceed target", async () => {
    const user = buildOrganizerUser("org-1");
    mockPlanRepo.findByKey.mockResolvedValue(buildCatalogPlan("starter")); // starter maxMembers=3

    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      currentPeriodEnd: inFuture,
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({
        id: "org-1",
        plan: "pro",
        memberIds: Array.from({ length: 10 }, (_, i) => `u${i}`),
      }),
    );

    await expect(service.downgrade("org-1", "starter", user)).rejects.toThrow("Limite du plan");
    expect(mockSubRepo.update).not.toHaveBeenCalled();
  });

  it("cancel() also schedules when a paid period is in force", async () => {
    const user = buildOrganizerUser("org-1");

    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      currentPeriodEnd: inFuture,
    });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(
      buildOrganization({ id: "org-1", plan: "pro", memberIds: [] }),
    );
    mockSubRepo.update.mockResolvedValue(undefined);

    const result = await service.cancel("org-1", user);

    expect(result).toEqual({ scheduled: true, effectiveAt: inFuture });
    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({
        scheduledChange: expect.objectContaining({
          toPlan: "free",
          reason: "cancel",
        }),
      }),
    );
  });
});

describe("SubscriptionService.revertScheduledChange", () => {
  it("clears scheduledChange and emits subscription.scheduled_reverted", async () => {
    const user = buildOrganizerUser("org-1");
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      scheduledChange: {
        toPlan: "free",
        effectiveAt: "2099-01-01T00:00:00.000Z",
        reason: "cancel",
        scheduledBy: user.uid,
        scheduledAt: new Date().toISOString(),
      },
    });
    mockSubRepo.update.mockResolvedValue(undefined);

    await service.revertScheduledChange("org-1", user);

    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ scheduledChange: null }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      "subscription.scheduled_reverted",
      expect.objectContaining({
        organizationId: "org-1",
        revertedToPlan: "free",
      }),
    );
  });

  it("is a no-op when no scheduled change exists", async () => {
    const user = buildOrganizerUser("org-1");
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
    });

    await expect(service.revertScheduledChange("org-1", user)).resolves.toBeUndefined();

    expect(mockSubRepo.update).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("is a no-op when no subscription exists at all (free org)", async () => {
    const user = buildOrganizerUser("org-1");
    mockSubRepo.findByOrganization.mockResolvedValue(null);

    await expect(service.revertScheduledChange("org-1", user)).resolves.toBeUndefined();

    expect(mockSubRepo.update).not.toHaveBeenCalled();
  });

  it("rejects non-organizer", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    await expect(service.revertScheduledChange("org-1", user)).rejects.toThrow(
      "Permission manquante",
    );
  });
});

describe("SubscriptionService.upgrade — clears any scheduled change", () => {
  it("wipes scheduledChange on upgrade (user changed mind)", async () => {
    const user = buildOrganizerUser("org-1");

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "starter", memberIds: ["u1"] }),
    });
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "starter",
      scheduledChange: {
        toPlan: "free",
        effectiveAt: "2099-01-01T00:00:00.000Z",
        reason: "cancel",
        scheduledBy: user.uid,
        scheduledAt: new Date().toISOString(),
      },
    });
    mockSubRepo.update.mockResolvedValue(undefined);
    mockSubRepo.findByIdOrThrow.mockResolvedValue({
      id: "sub-1",
      plan: "pro",
      status: "active",
    });

    await service.upgrade("org-1", { plan: "pro" }, user);

    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ scheduledChange: null }),
    );
  });
});

// ── Phase 5: assignPlan (admin per-org override) ──────────────────────────

describe("SubscriptionService.assignPlan", () => {
  function buildCatalogPlanFull(overrides: Partial<Record<string, unknown>> = {}) {
    const now = new Date().toISOString();
    return {
      id: "plan-custom",
      key: "custom_acme",
      name: { fr: "Acme", en: "Acme" },
      description: null,
      pricingModel: "custom" as const,
      priceXof: 49900,
      currency: "XOF" as const,
      limits: { maxEvents: 999, maxParticipantsPerEvent: 500, maxMembers: 10 },
      features: {
        qrScanning: true,
        paidTickets: true,
        customBadges: true,
        csvExport: true,
        smsNotifications: true,
        advancedAnalytics: true,
        speakerPortal: true,
        sponsorPortal: true,
        apiAccess: false,
        whiteLabel: false,
        promoCodes: true,
      },
      isSystem: false,
      isPublic: false,
      isArchived: false,
      sortOrder: 100,
      createdBy: "admin-1",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it("rejects non-superadmin (organizer lacks subscription:override)", async () => {
    const user = buildOrganizerUser("org-1");
    await expect(service.assignPlan("org-1", { planId: "plan-custom" }, user)).rejects.toThrow(
      "Permission manquante : subscription:override",
    );
  });

  it("rejects participant (lacks manage_billing)", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(
      service.assignPlan("org-1", { planId: "plan-custom" }, participant),
    ).rejects.toThrow("Permission manquante : organization:manage_billing");
  });

  it("assigns a catalog plan without overrides (superadmin)", async () => {
    const admin = buildSuperAdmin();
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(buildCatalogPlanFull());

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "free", memberIds: [] }),
    });
    mockSubRepo.findByOrganization.mockResolvedValue(null);
    mockSubRepo.create.mockResolvedValue({
      id: "sub-new",
      organizationId: "org-1",
      plan: "custom_acme",
      planId: "plan-custom",
      status: "active",
    });

    const sub = await service.assignPlan("org-1", { planId: "plan-custom" }, admin);

    expect(mockPlanRepo.findByIdOrThrow).toHaveBeenCalledWith("plan-custom");
    // tx.update wrote org.plan + denormalized effective fields
    const txArg = mockTxUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(txArg.plan).toBe("custom_acme");
    expect(txArg.effectivePlanKey).toBe("custom_acme");
    expect((txArg.effectiveLimits as { maxEvents: number }).maxEvents).toBe(999);
    // Subscription doc captures planId + assignedBy + assignedAt
    expect(mockSubRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-custom",
        plan: "custom_acme",
        assignedBy: admin.uid,
      }),
    );
    expect(sub.plan).toBe("custom_acme");
    // Domain event fires
    expect(eventBus.emit).toHaveBeenCalledWith(
      "subscription.overridden",
      expect.objectContaining({
        organizationId: "org-1",
        newPlanId: "plan-custom",
        newPlanKey: "custom_acme",
        hasOverrides: false,
        validUntil: null,
      }),
    );
  });

  it("assigns a plan with overrides (limits + validUntil + priceXof)", async () => {
    const admin = buildSuperAdmin();
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(buildCatalogPlanFull());

    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "pro", memberIds: ["u1"] }),
    });
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
    });
    mockSubRepo.update.mockResolvedValue(undefined);
    mockSubRepo.findByIdOrThrow.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "custom_acme",
      planId: "plan-custom",
      status: "active",
      priceXof: 250000,
    });

    await service.assignPlan(
      "org-1",
      {
        planId: "plan-custom",
        overrides: {
          limits: { maxEvents: -1 }, // unlimited override
          priceXof: 250000,
          validUntil: "2099-12-31T00:00:00.000Z",
          notes: "Deal Sonatel 2026",
        },
      },
      admin,
    );

    // Override applied to effective snapshot written to the org
    const txArg = mockTxUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect((txArg.effectiveLimits as { maxEvents: number }).maxEvents).toBe(-1); // stored form
    // Subscription doc gets overrides + bespoke price
    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({
        overrides: expect.objectContaining({
          limits: { maxEvents: -1 },
          priceXof: 250000,
          validUntil: "2099-12-31T00:00:00.000Z",
        }),
        priceXof: 250000,
        assignedBy: admin.uid,
      }),
    );
    // Event carries hasOverrides + validUntil
    expect(eventBus.emit).toHaveBeenCalledWith(
      "subscription.overridden",
      expect.objectContaining({
        hasOverrides: true,
        validUntil: "2099-12-31T00:00:00.000Z",
      }),
    );
  });

  it("wipes any previously scheduled change on assign", async () => {
    const admin = buildSuperAdmin();
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(buildCatalogPlanFull());
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "pro", memberIds: [] }),
    });
    mockSubRepo.findByOrganization.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "pro",
      status: "active",
      scheduledChange: {
        toPlan: "free",
        effectiveAt: "2099-01-01T00:00:00.000Z",
        reason: "cancel",
        scheduledBy: admin.uid,
        scheduledAt: new Date().toISOString(),
      },
    });
    mockSubRepo.update.mockResolvedValue(undefined);
    mockSubRepo.findByIdOrThrow.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-1",
      plan: "custom_acme",
      status: "active",
    });

    await service.assignPlan("org-1", { planId: "plan-custom" }, admin);

    expect(mockSubRepo.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ scheduledChange: null }),
    );
  });

  it("throws if the org doesn't exist", async () => {
    const admin = buildSuperAdmin();
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(buildCatalogPlanFull());
    mockTxGet.mockResolvedValue({ exists: false });

    await expect(
      service.assignPlan("missing-org", { planId: "plan-custom" }, admin),
    ).rejects.toThrow("Organisation introuvable");
  });

  it("cross-tenant by design — superadmin can assign to any org without membership", async () => {
    // Superadmin user has no organizationId set — proves we don't call
    // requireOrganizationAccess.
    const admin = buildSuperAdmin({ organizationId: undefined });
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(buildCatalogPlanFull());
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: "free", memberIds: [] }),
    });
    mockSubRepo.findByOrganization.mockResolvedValue(null);
    mockSubRepo.create.mockResolvedValue({
      id: "sub-x",
      organizationId: "any-org",
      plan: "custom_acme",
      status: "active",
    });

    await expect(
      service.assignPlan("any-org", { planId: "plan-custom" }, admin),
    ).resolves.toBeDefined();
  });
});
