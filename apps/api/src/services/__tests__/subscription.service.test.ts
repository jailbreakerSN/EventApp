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
