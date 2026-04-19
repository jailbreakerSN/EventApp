import { describe, it, expect, vi, beforeEach } from "vitest";
import { UploadService } from "../upload.service";
import {
  buildOrganizerUser,
  buildAuthUser,
  buildEvent,
  buildOrganization,
  buildSpeaker,
  buildSponsor,
} from "@/__tests__/factories";
import { type UploadUrlRequest } from "@teranga/shared-types";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const {
  mockEventRepo,
  mockOrgRepo,
  mockSpeakerRepo,
  mockSponsorRepo,
  mockRegistrationRepo,
  mockGetSignedUrl,
} = vi.hoisted(() => ({
  mockEventRepo: {
    findByIdOrThrow: vi.fn(),
  },
  mockOrgRepo: {
    findByIdOrThrow: vi.fn(),
  },
  mockSpeakerRepo: {
    findByIdOrThrow: vi.fn(),
  },
  mockSponsorRepo: {
    findByIdOrThrow: vi.fn(),
  },
  mockRegistrationRepo: {
    findExisting: vi.fn(),
  },
  mockGetSignedUrl: vi.fn().mockResolvedValue(["https://storage.googleapis.com/signed-url"]),
}));

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

vi.mock("@/repositories/speaker.repository", () => ({
  speakerRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockSpeakerRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/repositories/sponsor.repository", () => ({
  sponsorRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockSponsorRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/repositories/registration.repository", () => ({
  registrationRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockRegistrationRepo as Record<string, unknown>)[prop as string],
    },
  ),
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
  db: {},
  COLLECTIONS: {
    SPEAKERS: "speakers",
    SPONSORS: "sponsors",
    SPONSOR_LEADS: "sponsorLeads",
    EVENTS: "events",
    ORGANIZATIONS: "organizations",
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

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

    await expect(service.generateUploadUrl("event", "ev-1", dto, user)).rejects.toThrow(
      "Accès refusé",
    );
  });

  it("rejects participant without event:update permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.generateUploadUrl("event", "ev-1", dto, user)).rejects.toThrow(
      "Permission manquante",
    );
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

    await expect(service.generateUploadUrl("organization", "org-1", dto, user)).rejects.toThrow(
      "Accès refusé",
    );
  });

  it("generates signed URL for speaker photo when speaker owns profile", async () => {
    const user = buildAuthUser({ uid: "speaker-uid", roles: ["speaker"] });
    const speaker = buildSpeaker({ id: "sp-1", userId: "speaker-uid", organizationId: "org-1" });
    mockSpeakerRepo.findByIdOrThrow.mockResolvedValue(speaker);

    const result = await service.generateUploadUrl(
      "speaker",
      "sp-1",
      { ...dto, purpose: "photo" as const },
      user,
    );

    expect(result.uploadUrl).toBeDefined();
    expect(result.publicUrl).toContain("speakers/sp-1/photo");
  });

  it("allows organizer to upload for any speaker in their org", async () => {
    const user = buildOrganizerUser("org-1");
    const speaker = buildSpeaker({ id: "sp-1", userId: "other-user", organizationId: "org-1" });
    mockSpeakerRepo.findByIdOrThrow.mockResolvedValue(speaker);

    const result = await service.generateUploadUrl("speaker", "sp-1", dto, user);

    expect(result.uploadUrl).toBeDefined();
  });

  it("generates signed URL for sponsor logo when sponsor owns profile", async () => {
    const user = buildAuthUser({ uid: "sponsor-uid", roles: ["sponsor"] });
    const sponsor = buildSponsor({ id: "sp-1", userId: "sponsor-uid", organizationId: "org-1" });
    mockSponsorRepo.findByIdOrThrow.mockResolvedValue(sponsor);

    const result = await service.generateUploadUrl(
      "sponsor",
      "sp-1",
      { ...dto, purpose: "logo" as const },
      user,
    );

    expect(result.uploadUrl).toBeDefined();
    expect(result.publicUrl).toContain("sponsors/sp-1/logo");
  });

  it("rejects disallowed content type", async () => {
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(
      service.generateUploadUrl(
        "event",
        "ev-1",
        {
          fileName: "test.svg",
          contentType: "image/svg+xml" as unknown as UploadUrlRequest["contentType"],
          purpose: "cover" as const,
        },
        user,
      ),
    ).rejects.toThrow("not allowed");
  });

  it("generates signed URL for feed image when user is registered", async () => {
    const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });
    mockRegistrationRepo.findExisting.mockResolvedValue({
      id: "reg-1",
      eventId: "ev-1",
      userId: "user-1",
      status: "confirmed",
    });

    const result = await service.generateUploadUrl(
      "feed",
      "ev-1",
      { ...dto, purpose: "feed" as const },
      user,
    );

    expect(result.uploadUrl).toBeDefined();
    expect(result.publicUrl).toContain("feeds/ev-1/feed");
    expect(mockRegistrationRepo.findExisting).toHaveBeenCalledWith("ev-1", "user-1");
  });

  it("rejects feed upload when user is not registered for event", async () => {
    const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });
    mockRegistrationRepo.findExisting.mockResolvedValue(null);

    await expect(
      service.generateUploadUrl("feed", "ev-1", { ...dto, purpose: "feed" as const }, user),
    ).rejects.toThrow("registered");
  });

  // ── Sprint 1 PR 4/5: content-length enforcement at the GCS edge ────────

  it("signs a 10 MB content-length cap for images via x-goog-content-length-range", async () => {
    // Regression guard: the signed URL must include the
    // `x-goog-content-length-range` extension header so GCS rejects
    // oversize PUTs at the edge without trusting client-side validation.
    // Omitting the header → unbounded upload attack surface.
    const user = buildOrganizerUser("org-1");
    const event = buildEvent({ id: "ev-1", organizationId: "org-1" });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockGetSignedUrl.mockResolvedValueOnce(["https://storage.googleapis.com/signed-image"]);

    const result = await service.generateUploadUrl(
      "event",
      "ev-1",
      { fileName: "cover.jpg", contentType: "image/jpeg", purpose: "cover" },
      user,
    );

    const signCall = mockGetSignedUrl.mock.calls.at(-1)?.[0] as {
      extensionHeaders?: Record<string, string>;
    };
    expect(signCall.extensionHeaders).toEqual({
      "x-goog-content-length-range": `0,${10 * 1024 * 1024}`,
    });
    expect(result.maxBytes).toBe(10 * 1024 * 1024);
    // Response includes the required headers so clients know to
    // replay them on the PUT (server remains source of truth).
    expect(result.requiredHeaders).toEqual({
      "x-goog-content-length-range": `0,${10 * 1024 * 1024}`,
    });
  });

  it("signs a 20 MB cap for application/pdf (speaker slides)", async () => {
    const user = buildOrganizerUser("org-1");
    mockSpeakerRepo.findByIdOrThrow.mockResolvedValue(
      buildSpeaker({ id: "spk-1", organizationId: "org-1", userId: "someone-else" }),
    );
    mockGetSignedUrl.mockResolvedValueOnce(["https://storage.googleapis.com/signed-pdf"]);

    const result = await service.generateUploadUrl(
      "speaker",
      "spk-1",
      { fileName: "deck.pdf", contentType: "application/pdf", purpose: "slides" },
      user,
    );

    const signCall = mockGetSignedUrl.mock.calls.at(-1)?.[0] as {
      extensionHeaders?: Record<string, string>;
    };
    expect(signCall.extensionHeaders).toEqual({
      "x-goog-content-length-range": `0,${20 * 1024 * 1024}`,
    });
    expect(result.maxBytes).toBe(20 * 1024 * 1024);
  });
});
