import { describe, it, expect, vi, beforeEach } from "vitest";
import { SponsorService } from "../sponsor.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildEvent,
  buildSponsor,
} from "@/__tests__/factories";

const { mockSponsorRepo, mockSponsorLeadRepo, mockEventRepo, mockUserRepo, mockEventBus } = vi.hoisted(() => ({
  mockSponsorRepo: {
    findByIdOrThrow: vi.fn(),
    findByEvent: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mockSponsorLeadRepo: {
    findByParticipant: vi.fn(),
    findBySponsor: vi.fn(),
    create: vi.fn(),
  },
  mockEventRepo: {
    findByIdOrThrow: vi.fn(),
  },
  mockUserRepo: {
    findById: vi.fn(),
  },
  mockEventBus: { emit: vi.fn() },
}));

vi.mock("@/repositories/sponsor.repository", () => ({
  sponsorRepository: new Proxy({}, {
    get: (_t, p) => (mockSponsorRepo as Record<string, unknown>)[p as string],
  }),
}));

vi.mock("@/repositories/sponsor-lead.repository", () => ({
  sponsorLeadRepository: new Proxy({}, {
    get: (_t, p) => (mockSponsorLeadRepo as Record<string, unknown>)[p as string],
  }),
}));

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy({}, {
    get: (_t, p) => (mockEventRepo as Record<string, unknown>)[p as string],
  }),
}));

vi.mock("@/repositories/registration.repository", () => ({
  registrationRepository: {},
}));

vi.mock("@/repositories/user.repository", () => ({
  userRepository: new Proxy({}, {
    get: (_t, p) => (mockUserRepo as Record<string, unknown>)[p as string],
  }),
}));

vi.mock("@/events/event-bus", () => ({ eventBus: mockEventBus }));
vi.mock("@/context/request-context", () => ({ getRequestId: () => "test-req" }));
vi.mock("@/services/qr-signing", () => ({
  verifyQrPayload: vi.fn((qr: string) => {
    if (qr.includes("valid")) return { registrationId: "reg-1", eventId: "ev-1", userId: "user-p" };
    return null;
  }),
}));

const service = new SponsorService();

beforeEach(() => vi.clearAllMocks());

describe("SponsorService.createSponsor", () => {
  const orgId = "org-1";
  const event = buildEvent({ id: "ev-1", organizationId: orgId });
  const organizer = buildOrganizerUser(orgId);

  beforeEach(() => {
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockSponsorRepo.create.mockImplementation(async (data: unknown) => ({
      ...(data as object),
      id: "sponsor-new",
    }));
  });

  it("creates a sponsor for an event", async () => {
    const result = await service.createSponsor(
      { eventId: "ev-1", companyName: "TechCorp", tier: "gold" },
      organizer,
    );
    expect(result.companyName).toBe("TechCorp");
    expect(result.tier).toBe("gold");
    expect(mockSponsorRepo.create).toHaveBeenCalledTimes(1);
  });

  it("rejects participant without permission", async () => {
    const participant = buildAuthUser();
    await expect(
      service.createSponsor({ eventId: "ev-1", companyName: "Test", tier: "bronze" }, participant),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects organizer from different org", async () => {
    const other = buildOrganizerUser("org-other");
    await expect(
      service.createSponsor({ eventId: "ev-1", companyName: "Test", tier: "bronze" }, other),
    ).rejects.toThrow("Accès refusé");
  });
});

describe("SponsorService.scanLead", () => {
  const orgId = "org-1";
  const sponsor = buildSponsor({ id: "sp-1", eventId: "ev-1", organizationId: orgId });
  const sponsorUser = buildAuthUser({ roles: ["sponsor"] });

  beforeEach(() => {
    mockSponsorRepo.findByIdOrThrow.mockResolvedValue(sponsor);
    mockSponsorLeadRepo.findByParticipant.mockResolvedValue(null);
    mockUserRepo.findById.mockResolvedValue({ uid: "user-p", displayName: "Test User", email: "test@test.com", phone: null });
    mockSponsorLeadRepo.create.mockImplementation(async (data: unknown) => ({
      ...(data as object),
      id: "lead-new",
    }));
  });

  it("captures a lead from a valid QR scan", async () => {
    const result = await service.scanLead(
      "sp-1",
      { qrCodeValue: "reg-1:ev-1:user-p:valid:sig" },
      sponsorUser,
    );
    expect(result.participantName).toBe("Test User");
    expect(mockSponsorLeadRepo.create).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid QR code", async () => {
    await expect(
      service.scanLead("sp-1", { qrCodeValue: "bad" }, sponsorUser),
    ).rejects.toThrow("QR code invalide");
  });

  it("rejects duplicate lead", async () => {
    mockSponsorLeadRepo.findByParticipant.mockResolvedValue({ id: "existing" });
    await expect(
      service.scanLead("sp-1", { qrCodeValue: "reg-1:ev-1:user-p:valid:sig" }, sponsorUser),
    ).rejects.toThrow("déjà été scanné");
  });

  it("rejects if badge is for wrong event", async () => {
    const wrongEventSponsor = buildSponsor({ id: "sp-1", eventId: "ev-OTHER", organizationId: orgId });
    mockSponsorRepo.findByIdOrThrow.mockResolvedValue(wrongEventSponsor);
    await expect(
      service.scanLead("sp-1", { qrCodeValue: "reg-1:ev-1:user-p:valid:sig" }, sponsorUser),
    ).rejects.toThrow("n'appartient pas");
  });
});

describe("SponsorService.deleteSponsor", () => {
  it("soft-deletes by setting isActive to false", async () => {
    const orgId = "org-1";
    const sponsor = buildSponsor({ id: "sp-1", organizationId: orgId });
    const organizer = buildOrganizerUser(orgId);

    mockSponsorRepo.findByIdOrThrow.mockResolvedValue(sponsor);
    mockSponsorRepo.update.mockResolvedValue(undefined);

    await service.deleteSponsor("sp-1", organizer);
    expect(mockSponsorRepo.update).toHaveBeenCalledWith("sp-1", expect.objectContaining({
      isActive: false,
    }));
  });
});
