import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanService } from "../plan.service";
import { buildAuthUser, buildOrganizerUser, buildSuperAdmin } from "@/__tests__/factories";
import { type Plan, type CreatePlanDto, PLAN_LIMIT_UNLIMITED } from "@teranga/shared-types";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockPlanRepo = {
  findById: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findByKey: vi.fn(),
  listCatalog: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/repositories/plan.repository", () => ({
  planRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockPlanRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

const mockEventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn(), removeAllListeners: vi.fn() };
vi.mock("@/events/event-bus", () => ({
  eventBus: new Proxy(
    {},
    { get: (_t, p) => (mockEventBus as Record<string, unknown>)[p as string] },
  ),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildPlan(overrides: Partial<Plan> = {}): Plan {
  const now = new Date().toISOString();
  return {
    id: "plan-free",
    key: "free",
    name: { fr: "Teranga Libre", en: "Teranga Free" },
    description: null,
    pricingModel: "free",
    priceXof: 0,
    currency: "XOF",
    limits: { maxEvents: 3, maxParticipantsPerEvent: 50, maxMembers: 1 },
    features: {
      qrScanning: false,
      paidTickets: false,
      customBadges: false,
      csvExport: false,
      smsNotifications: false,
      advancedAnalytics: false,
      speakerPortal: false,
      sponsorPortal: false,
      apiAccess: false,
      whiteLabel: false,
      promoCodes: false,
    },
    isSystem: true,
    isPublic: true,
    isArchived: false,
    sortOrder: 0,
    version: 1,
    lineageId: "lin-free-system",
    isLatest: true,
    previousVersionId: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const baseCreateDto: CreatePlanDto = {
  key: "custom_acme",
  name: { fr: "Plan Acme", en: "Acme Plan" },
  description: null,
  pricingModel: "fixed",
  priceXof: 49900,
  limits: {
    maxEvents: PLAN_LIMIT_UNLIMITED,
    maxParticipantsPerEvent: 5000,
    maxMembers: 20,
  },
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
  isPublic: false,
  sortOrder: 10,
};

// ─── Tests ──────────────────────────────────────────────────────────────────

const service = new PlanService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlanService.getPublicCatalog", () => {
  it("returns the public, non-archived catalog without requiring permissions", async () => {
    const plans = [buildPlan({ id: "plan-free", key: "free" })];
    mockPlanRepo.listCatalog.mockResolvedValue(plans);

    const result = await service.getPublicCatalog();

    expect(mockPlanRepo.listCatalog).toHaveBeenCalledWith({
      includeArchived: false,
      includePrivate: false,
    });
    expect(result).toEqual(plans);
  });
});

describe("PlanService.getByKey", () => {
  it("throws NotFound when plan is archived", async () => {
    mockPlanRepo.findByKey.mockResolvedValue(buildPlan({ isArchived: true }));
    await expect(service.getByKey("free")).rejects.toThrow("introuvable");
  });

  it("throws NotFound when plan does not exist", async () => {
    mockPlanRepo.findByKey.mockResolvedValue(null);
    await expect(service.getByKey("missing")).rejects.toThrow("introuvable");
  });

  it("returns the plan when it exists and is active", async () => {
    const plan = buildPlan();
    mockPlanRepo.findByKey.mockResolvedValue(plan);
    expect(await service.getByKey("free")).toBe(plan);
  });
});

describe("PlanService.listAll (admin)", () => {
  it("rejects non-superadmin callers", async () => {
    const user = buildOrganizerUser("org-1");
    await expect(service.listAll(user)).rejects.toThrow("Permission manquante");
  });

  it("returns all plans (archived + private) to superadmin", async () => {
    const user = buildSuperAdmin();
    const plans = [buildPlan({ isArchived: true })];
    mockPlanRepo.listCatalog.mockResolvedValue(plans);

    await service.listAll(user);

    expect(mockPlanRepo.listCatalog).toHaveBeenCalledWith({
      includeArchived: true,
      includePrivate: true,
    });
  });
});

describe("PlanService.create", () => {
  it("rejects non-superadmin callers", async () => {
    const user = buildAuthUser({ roles: ["organizer"] });
    await expect(service.create(baseCreateDto, user)).rejects.toThrow("Permission manquante");
  });

  it("throws Conflict when a plan with the same key already exists", async () => {
    const user = buildSuperAdmin();
    mockPlanRepo.findByKey.mockResolvedValue(buildPlan({ key: "custom_acme" }));

    await expect(service.create(baseCreateDto, user)).rejects.toThrow("existe déjà");
  });

  it("creates a non-system plan and emits plan.created", async () => {
    const user = buildSuperAdmin();
    mockPlanRepo.findByKey.mockResolvedValue(null);
    const created = buildPlan({ id: "plan-acme", key: "custom_acme", isSystem: false });
    mockPlanRepo.create.mockResolvedValue(created);

    const result = await service.create(baseCreateDto, user);

    expect(result).toBe(created);
    expect(mockPlanRepo.create).toHaveBeenCalled();
    const arg = mockPlanRepo.create.mock.calls[0][0];
    expect(arg.isSystem).toBe(false);
    expect(arg.isArchived).toBe(false);
    expect(arg.createdBy).toBe(user.uid);

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "plan.created",
      expect.objectContaining({ planId: "plan-acme", key: "custom_acme" }),
    );
  });
});

describe("PlanService.update", () => {
  it("rejects non-superadmin callers", async () => {
    const user = buildOrganizerUser("org-1");
    await expect(service.update("plan-1", { priceXof: 1000 }, user)).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("editing priceXof mints a NEW version and flips previous isLatest=false (Phase 7)", async () => {
    const user = buildSuperAdmin();
    const existing = buildPlan({
      id: "plan-pro-v1",
      isSystem: true,
      key: "pro",
      priceXof: 29900,
      version: 1,
      lineageId: "lin-pro",
      isLatest: true,
    });
    const newVersion = {
      ...existing,
      id: "plan-pro-v2",
      priceXof: 34900,
      version: 2,
      previousVersionId: existing.id,
    };
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(existing);
    mockPlanRepo.create.mockResolvedValue(newVersion);
    mockPlanRepo.update.mockResolvedValue(undefined);

    const result = await service.update(existing.id, { priceXof: 34900 }, user);

    // A fresh doc was minted — the returned plan is the new version.
    expect(result.id).toBe("plan-pro-v2");
    expect(result.priceXof).toBe(34900);
    expect(mockPlanRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "pro",
        priceXof: 34900,
        version: 2,
        lineageId: "lin-pro",
        isLatest: true,
        previousVersionId: existing.id,
      }),
    );
    // Previous version is tombstoned as non-latest.
    expect(mockPlanRepo.update).toHaveBeenCalledWith(existing.id, { isLatest: false });
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "plan.updated",
      expect.objectContaining({ planId: "plan-pro-v2", changes: ["priceXof"] }),
    );
  });

  it("editing sortOrder only is an in-place patch — no new version (Phase 7)", async () => {
    const user = buildSuperAdmin();
    const existing = buildPlan({ id: "plan-pro", isSystem: true, key: "pro", sortOrder: 2 });
    mockPlanRepo.findByIdOrThrow
      .mockResolvedValueOnce(existing) // initial load
      .mockResolvedValueOnce({ ...existing, sortOrder: 5 }); // after patch
    mockPlanRepo.update.mockResolvedValue(undefined);

    const result = await service.update(existing.id, { sortOrder: 5 }, user);

    expect(result.sortOrder).toBe(5);
    expect(mockPlanRepo.create).not.toHaveBeenCalled();
    expect(mockPlanRepo.update).toHaveBeenCalledWith(existing.id, { sortOrder: 5 });
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "plan.updated",
      expect.objectContaining({ planId: existing.id, changes: ["sortOrder"] }),
    );
  });

  it("refuses to edit a historical (non-latest) version", async () => {
    const user = buildSuperAdmin();
    const historical = buildPlan({
      id: "plan-pro-v1",
      isSystem: true,
      key: "pro",
      isLatest: false,
    });
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(historical);

    await expect(service.update(historical.id, { priceXof: 1 }, user)).rejects.toThrow(
      "version historique",
    );
    expect(mockPlanRepo.create).not.toHaveBeenCalled();
    expect(mockPlanRepo.update).not.toHaveBeenCalled();
  });

  it("refuses to archive a system plan", async () => {
    const user = buildSuperAdmin();
    const existing = buildPlan({ isSystem: true, key: "free" });
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(existing);

    await expect(service.update(existing.id, { isArchived: true }, user)).rejects.toThrow(
      "ne peuvent pas être archivés",
    );
    expect(mockPlanRepo.update).not.toHaveBeenCalled();
  });

  it("is a no-op when no fields are provided", async () => {
    const user = buildSuperAdmin();
    const existing = buildPlan({ isSystem: false });
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(existing);

    const result = await service.update(existing.id, {}, user);

    expect(result).toBe(existing);
    expect(mockPlanRepo.update).not.toHaveBeenCalled();
    expect(mockEventBus.emit).not.toHaveBeenCalled();
  });
});

describe("PlanService.archive", () => {
  it("refuses to archive system plans", async () => {
    const user = buildSuperAdmin();
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(buildPlan({ isSystem: true }));

    await expect(service.archive("plan-free", user)).rejects.toThrow(
      "ne peuvent pas être supprimés",
    );
  });

  it("is idempotent when plan is already archived", async () => {
    const user = buildSuperAdmin();
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(
      buildPlan({ isSystem: false, isArchived: true }),
    );

    await service.archive("plan-1", user);

    expect(mockPlanRepo.update).not.toHaveBeenCalled();
    expect(mockEventBus.emit).not.toHaveBeenCalled();
  });

  it("archives a custom plan and emits plan.archived", async () => {
    const user = buildSuperAdmin();
    const existing = buildPlan({ id: "plan-acme", key: "custom_acme", isSystem: false });
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(existing);

    await service.archive("plan-acme", user);

    expect(mockPlanRepo.update).toHaveBeenCalledWith("plan-acme", { isArchived: true });
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      "plan.archived",
      expect.objectContaining({ planId: "plan-acme", key: "custom_acme" }),
    );
  });
});

describe("PlanService.getById", () => {
  it("requires plan:manage permission", async () => {
    const user = buildOrganizerUser("org-1");
    await expect(service.getById("plan-1", user)).rejects.toThrow("Permission manquante");
  });

  it("returns the plan for a superadmin", async () => {
    const user = buildSuperAdmin();
    const plan = buildPlan();
    mockPlanRepo.findByIdOrThrow.mockResolvedValue(plan);

    expect(await service.getById(plan.id, user)).toBe(plan);
  });
});
