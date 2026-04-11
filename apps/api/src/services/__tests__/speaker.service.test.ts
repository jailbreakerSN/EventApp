import { describe, it, expect, vi, beforeEach } from "vitest";
import { SpeakerService } from "../speaker.service";
import { buildAuthUser, buildOrganizerUser, buildEvent, buildSpeaker } from "@/__tests__/factories";

// ─── Mocks (vi.hoisted) ──────────────────────────────────────────────────

const { mockSpeakerRepo, mockEventRepo, mockEventBus } = vi.hoisted(() => ({
  mockSpeakerRepo: {
    findByIdOrThrow: vi.fn(),
    findByEvent: vi.fn(),
    findByUser: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mockEventRepo: {
    findByIdOrThrow: vi.fn(),
  },
  mockEventBus: { emit: vi.fn() },
}));

vi.mock("@/repositories/speaker.repository", () => ({
  speakerRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockSpeakerRepo as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockEventRepo as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/events/event-bus", () => ({ eventBus: mockEventBus }));
vi.mock("@/context/request-context", () => ({ getRequestId: () => "test-req" }));

const service = new SpeakerService();

beforeEach(() => vi.clearAllMocks());

// ─── createSpeaker ──────────────────────────────────────────────────────

describe("SpeakerService.createSpeaker", () => {
  const orgId = "org-1";
  const event = buildEvent({ id: "ev-1", organizationId: orgId });
  const organizer = buildOrganizerUser(orgId);

  beforeEach(() => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockSpeakerRepo.findByUser.mockResolvedValue(null);
    mockSpeakerRepo.create.mockImplementation(async (data: unknown) => ({
      ...(data as object),
      id: "sp-new",
    }));
  });

  it("creates a speaker for an event", async () => {
    const result = await service.createSpeaker(
      { eventId: "ev-1", name: "Ada Lovelace", title: "Mathematician" },
      organizer,
    );
    expect(result.name).toBe("Ada Lovelace");
    expect(mockSpeakerRepo.create).toHaveBeenCalledTimes(1);
  });

  it("rejects if user lacks permission", async () => {
    const participant = buildAuthUser();
    await expect(
      service.createSpeaker({ eventId: "ev-1", name: "Test" }, participant),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects if organizer is from different org", async () => {
    const other = buildOrganizerUser("org-other");
    await expect(service.createSpeaker({ eventId: "ev-1", name: "Test" }, other)).rejects.toThrow(
      "Accès refusé",
    );
  });

  it("rejects duplicate speaker (same userId + event)", async () => {
    mockSpeakerRepo.findByUser.mockResolvedValue(buildSpeaker());
    await expect(
      service.createSpeaker({ eventId: "ev-1", name: "Test", userId: "user-1" }, organizer),
    ).rejects.toThrow("déjà intervenant");
  });
});

// ─── updateSpeaker ──────────────────────────────────────────────────────

describe("SpeakerService.updateSpeaker", () => {
  const orgId = "org-1";
  const speaker = buildSpeaker({ id: "sp-1", organizationId: orgId, userId: "user-speaker" });

  beforeEach(() => {
    mockSpeakerRepo.findByIdOrThrow.mockResolvedValue(speaker);
    mockSpeakerRepo.update.mockResolvedValue(undefined);
  });

  it("allows organizer to update any speaker", async () => {
    const organizer = buildOrganizerUser(orgId);
    await service.updateSpeaker("sp-1", { bio: "Updated" }, organizer);
    expect(mockSpeakerRepo.update).toHaveBeenCalledTimes(1);
  });

  it("allows speaker to update own profile", async () => {
    const speakerUser = buildAuthUser({ uid: "user-speaker", roles: ["speaker"] });
    mockSpeakerRepo.findByIdOrThrow
      .mockResolvedValueOnce(speaker)
      .mockResolvedValueOnce({ ...speaker, bio: "Updated" });
    await service.updateSpeaker("sp-1", { bio: "Updated" }, speakerUser);
    expect(mockSpeakerRepo.update).toHaveBeenCalledTimes(1);
  });
});

// ─── listEventSpeakers ──────────────────────────────────────────────────

describe("SpeakerService.listEventSpeakers", () => {
  it("returns paginated speakers", async () => {
    const speakers = [buildSpeaker(), buildSpeaker()];
    mockSpeakerRepo.findByEvent.mockResolvedValue({
      data: speakers,
      meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
    });

    const result = await service.listEventSpeakers("ev-1", { page: 1, limit: 50 });
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });
});

// ─── deleteSpeaker ──────────────────────────────────────────────────────

describe("SpeakerService.deleteSpeaker", () => {
  it("soft-deletes by clearing sessionIds", async () => {
    const orgId = "org-1";
    const speaker = buildSpeaker({ id: "sp-1", organizationId: orgId });
    const organizer = buildOrganizerUser(orgId);

    mockSpeakerRepo.findByIdOrThrow.mockResolvedValue(speaker);
    mockSpeakerRepo.update.mockResolvedValue(undefined);

    await service.deleteSpeaker("sp-1", organizer);
    expect(mockSpeakerRepo.update).toHaveBeenCalledWith(
      "sp-1",
      expect.objectContaining({
        isConfirmed: false,
        sessionIds: [],
      }),
    );
  });

  it("rejects unauthorized user", async () => {
    const participant = buildAuthUser();
    await expect(service.deleteSpeaker("sp-1", participant)).rejects.toThrow(
      "Permission manquante",
    );
  });
});
