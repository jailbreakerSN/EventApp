import { describe, it, expect, vi, beforeEach } from "vitest";
import { UploadService } from "../upload.service";
import { buildOrganizerUser, buildAuthUser, buildEvent, buildOrganization } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockEventRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockGetSignedUrl = vi.fn().mockResolvedValue(["https://storage.googleapis.com/signed-url"]);

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy({}, {
    get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy({}, {
    get: (_target, prop) => (mockOrgRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/config/firebase", () => ({
  storage: {
    bucket: () => ({
      name: "test-bucket",
      file: () => ({
        getSignedUrl: mockGetSignedUrl,
      }),
    }),
  },
}));

// ─── Tests ──────────────────────────��───────────────────────���──────────────

const service = new UploadService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UploadService.generateUploadUrl", () => {
  const dto = {
    fileName: "photo.jpg",
    contentType: "image/jpeg" as const,
    purpose: "cover" as const,
  };

  it("generates signed URL for event image when user belongs to org", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    const result = await service.generateUploadUrl("event", "ev-1", dto, user);

    expect(result.uploadUrl).toBeDefined();
    expect(result.publicUrl).toContain("test-bucket");
    expect(mockEventRepo.findByIdOrThrow).toHaveBeenCalledWith("ev-1");
  });

  it("rejects upload when user does not belong to event's org", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.generateUploadUrl("event", "ev-1", dto, user),
    ).rejects.toThrow("Access denied");
  });

  it("rejects participant without event:update permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(
      service.generateUploadUrl("event", "ev-1", dto, user),
    ).rejects.toThrow("Missing permission");
  });

  it("validates org access for organization uploads", async () => {
    const user = buildOrganizerUser("org-1");
    const org = buildOrganization({ id: "org-1" });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);

    const result = await service.generateUploadUrl("organization", "org-1", dto, user);

    expect(result.uploadUrl).toBeDefined();
    expect(mockOrgRepo.findByIdOrThrow).toHaveBeenCalledWith("org-1");
  });

  it("rejects organization upload for different org", async () => {
    const user = buildOrganizerUser("org-other");
    const org = buildOrganization({ id: "org-1" });
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);

    await expect(
      service.generateUploadUrl("organization", "org-1", dto, user),
    ).rejects.toThrow("Access denied");
  });
});
