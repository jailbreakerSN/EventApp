import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadgeTemplateService } from "../badge-template.service";
import { buildOrganizerUser, buildAuthUser, buildOrganization } from "@/__tests__/factories";
import { type BadgeTemplate, type CreateBadgeTemplateDto } from "@teranga/shared-types";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockTemplateRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findByOrganization: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
};

const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
};

vi.mock("@/repositories/badge-template.repository", () => ({
  badgeTemplateRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockTemplateRepo as Record<string, unknown>)[prop as string],
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTemplate(overrides: Partial<BadgeTemplate> = {}): BadgeTemplate {
  const now = new Date().toISOString();
  return {
    id: "tpl-1",
    organizationId: "org-1",
    name: "Default Badge",
    width: 85.6,
    height: 54.0,
    backgroundColor: "#FFFFFF",
    primaryColor: "#1A1A2E",
    showQR: true,
    showName: true,
    showOrganization: true,
    showRole: true,
    showPhoto: false,
    customFields: [],
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

const service = new BadgeTemplateService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BadgeTemplateService.create", () => {
  it("creates a template when user has permission and org access", async () => {
    const user = buildOrganizerUser("org-1");
    // customBadges feature requires starter-or-better after P3 gate.
    const org = buildOrganization({ id: "org-1", plan: "starter" });
    const template = buildTemplate();

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockTemplateRepo.create.mockResolvedValue(template);

    const result = await service.create(
      {
        organizationId: "org-1",
        name: "Default Badge",
        width: 85.6,
        height: 54.0,
        backgroundColor: "#FFFFFF",
        primaryColor: "#1A1A2E",
        showQR: true,
        showName: true,
        showOrganization: true,
        showRole: true,
        showPhoto: false,
        customFields: [],
        isDefault: false,
      },
      user,
    );

    expect(result.name).toBe("Default Badge");
    expect(mockTemplateRepo.create).toHaveBeenCalled();
  });

  it("rejects participant without badge:generate permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(
      service.create(
        { organizationId: "org-1", name: "Test" } as unknown as CreateBadgeTemplateDto,
        user,
      ),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects when user doesn't belong to the org", async () => {
    const user = buildOrganizerUser("org-other");
    const org = buildOrganization({ id: "org-1" });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);

    await expect(
      service.create(
        { organizationId: "org-1", name: "Test" } as unknown as CreateBadgeTemplateDto,
        user,
      ),
    ).rejects.toThrow("Accès refusé");
  });
});

describe("BadgeTemplateService.getById", () => {
  it("returns template when user has access", async () => {
    const user = buildOrganizerUser("org-1");
    const template = buildTemplate({ organizationId: "org-1" });
    mockTemplateRepo.findByIdOrThrow.mockResolvedValue(template);

    const result = await service.getById("tpl-1", user);
    expect(result.id).toBe("tpl-1");
  });

  it("rejects when user doesn't belong to template's org", async () => {
    const user = buildOrganizerUser("org-other");
    const template = buildTemplate({ organizationId: "org-1" });
    mockTemplateRepo.findByIdOrThrow.mockResolvedValue(template);

    await expect(service.getById("tpl-1", user)).rejects.toThrow("Accès refusé");
  });
});

describe("BadgeTemplateService.remove", () => {
  it("soft-deletes a template", async () => {
    const user = buildOrganizerUser("org-1");
    const template = buildTemplate({ organizationId: "org-1" });
    const org = buildOrganization({ id: "org-1", plan: "starter" });
    mockTemplateRepo.findByIdOrThrow.mockResolvedValue(template);
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockTemplateRepo.softDelete.mockResolvedValue(undefined);

    await service.remove("tpl-1", user);

    expect(mockTemplateRepo.softDelete).toHaveBeenCalledWith("tpl-1");
  });
});

// ─── listByOrganization (data-listing doctrine wiring) ───────────────────────
//
// Four mandatory cases per the test contract: happy path (incl. server-
// side q + pagination + sort propagation), permission denial, org-access
// denial, error path. Plus the doctrine-specific assertions: meta.total
// reflects the FILTERED count (not the unfiltered fetch), pagination
// slices the filtered set, accent-folded substring matches "Sénégal" vs
// "senegal".

describe("BadgeTemplateService.listByOrganization", () => {
  const baseQuery = {
    organizationId: "org-1",
    page: 1,
    limit: 25,
    orderBy: "name" as const,
    orderDir: "asc" as const,
  };

  it("returns paginated templates and forwards orderBy/orderDir/isDefault to the repo", async () => {
    const user = buildOrganizerUser("org-1");
    const templates = [
      buildTemplate({ id: "t1", name: "Badge Standard" }),
      buildTemplate({ id: "t2", name: "Badge VIP" }),
    ];
    mockTemplateRepo.findByOrganization.mockResolvedValue(templates);

    const result = await service.listByOrganization(
      { ...baseQuery, isDefault: false, orderBy: "createdAt", orderDir: "desc" },
      user,
    );

    expect(result.data).toHaveLength(2);
    expect(result.meta).toEqual({ page: 1, limit: 25, total: 2, totalPages: 1 });
    expect(mockTemplateRepo.findByOrganization).toHaveBeenCalledWith("org-1", {
      isDefault: false,
      orderBy: "createdAt",
      orderDir: "desc",
    });
  });

  it("filters by accent-folded substring on name (Sénégal matches senegal)", async () => {
    const user = buildOrganizerUser("org-1");
    const templates = [
      buildTemplate({ id: "t1", name: "Sénégal Conférence" }),
      buildTemplate({ id: "t2", name: "Côte d'Ivoire Workshop" }),
      buildTemplate({ id: "t3", name: "Mali Hackathon" }),
    ];
    mockTemplateRepo.findByOrganization.mockResolvedValue(templates);

    const result = await service.listByOrganization({ ...baseQuery, q: "senegal" }, user);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("t1");
    expect(result.meta.total).toBe(1);
  });

  it("paginates the filtered set honestly (page 2 of 3 with limit=1 yields t2)", async () => {
    const user = buildOrganizerUser("org-1");
    const templates = [
      buildTemplate({ id: "t1", name: "A Badge" }),
      buildTemplate({ id: "t2", name: "B Badge" }),
      buildTemplate({ id: "t3", name: "C Badge" }),
    ];
    mockTemplateRepo.findByOrganization.mockResolvedValue(templates);

    const result = await service.listByOrganization(
      { ...baseQuery, page: 2, limit: 1 },
      user,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("t2");
    expect(result.meta).toEqual({ page: 2, limit: 1, total: 3, totalPages: 3 });
  });

  it("rejects participant without badge:generate permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.listByOrganization(baseQuery, user)).rejects.toThrow(
      "Permission manquante",
    );
    expect(mockTemplateRepo.findByOrganization).not.toHaveBeenCalled();
  });

  it("rejects when user doesn't belong to the requested org", async () => {
    const user = buildOrganizerUser("org-other");

    await expect(service.listByOrganization(baseQuery, user)).rejects.toThrow("Accès refusé");
    expect(mockTemplateRepo.findByOrganization).not.toHaveBeenCalled();
  });

  it("propagates Firestore errors instead of swallowing them", async () => {
    const user = buildOrganizerUser("org-1");
    mockTemplateRepo.findByOrganization.mockRejectedValue(new Error("FAILED_PRECONDITION: index"));

    await expect(service.listByOrganization(baseQuery, user)).rejects.toThrow(
      "FAILED_PRECONDITION: index",
    );
  });
});
