import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadgeTemplateService } from "../badge-template.service";
import { buildOrganizerUser, buildAuthUser, buildOrganization } from "@/__tests__/factories";
import { type BadgeTemplate } from "@teranga/shared-types";

// ─── Mocks ───────────────────────────────────────────────────���─────────────

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
  badgeTemplateRepository: new Proxy({}, {
    get: (_target, prop) => (mockTemplateRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy({}, {
    get: (_target, prop) => (mockOrgRepo as Record<string, unknown>)[prop as string],
  }),
}));

// ─── Helpers ────────��─────────────────────────────��────────────────────────

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

// ─── Tests ─────────���──────────────────────────────���────────────────────────

const service = new BadgeTemplateService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BadgeTemplateService.create", () => {
  it("creates a template when user has permission and org access", async () => {
    const user = buildOrganizerUser("org-1");
    const org = buildOrganization({ id: "org-1" });
    const template = buildTemplate();

    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockTemplateRepo.create.mockResolvedValue(template);

    const result = await service.create({
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
    }, user);

    expect(result.name).toBe("Default Badge");
    expect(mockTemplateRepo.create).toHaveBeenCalled();
  });

  it("rejects participant without badge:generate permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(
      service.create({ organizationId: "org-1", name: "Test" } as any, user),
    ).rejects.toThrow("Missing permission");
  });

  it("rejects when user doesn't belong to the org", async () => {
    const user = buildOrganizerUser("org-other");
    const org = buildOrganization({ id: "org-1" });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);

    await expect(
      service.create({ organizationId: "org-1", name: "Test" } as any, user),
    ).rejects.toThrow("Access denied");
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

    await expect(service.getById("tpl-1", user)).rejects.toThrow("Access denied");
  });
});

describe("BadgeTemplateService.remove", () => {
  it("soft-deletes a template", async () => {
    const user = buildOrganizerUser("org-1");
    const template = buildTemplate({ organizationId: "org-1" });
    mockTemplateRepo.findByIdOrThrow.mockResolvedValue(template);
    mockTemplateRepo.softDelete.mockResolvedValue(undefined);

    await service.remove("tpl-1", user);

    expect(mockTemplateRepo.softDelete).toHaveBeenCalledWith("tpl-1");
  });
});
