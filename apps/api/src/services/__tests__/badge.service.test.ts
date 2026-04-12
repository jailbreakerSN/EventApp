import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadgeService } from "../badge.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildSuperAdmin,
  buildEvent,
  buildRegistration,
} from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockEventRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockRegistrationRepo = {
  findByIdOrThrow: vi.fn(),
  findByEventCursor: vi.fn(),
};

const mockUserRepo = {
  findById: vi.fn(),
  batchGet: vi.fn(),
  getFcmTokens: vi.fn(),
};

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
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

vi.mock("@/repositories/user.repository", () => ({
  userRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockUserRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Mock Firestore collections for badges / templates
const mockBadgeDocSet = vi.fn().mockResolvedValue(undefined);
const mockBadgeDocGet = vi.fn();
const mockBadgeDocUpdate = vi.fn().mockResolvedValue(undefined);
const mockBadgeDocRef = {
  id: "badge-1",
  set: mockBadgeDocSet,
  get: mockBadgeDocGet,
  update: mockBadgeDocUpdate,
};

const mockTemplateDocGet = vi.fn();
const mockTemplateDocRef = { get: mockTemplateDocGet };

const mockBadgeWhereGet = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === "badges") {
        return {
          doc: vi.fn(() => mockBadgeDocRef),
          where: vi.fn(() => ({
            limit: vi.fn(() => ({ get: mockBadgeWhereGet })),
            get: mockBadgeWhereGet,
          })),
        };
      }
      if (name === "badgeTemplates") {
        return {
          doc: vi.fn(() => mockTemplateDocRef),
          where: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ empty: true }),
              })),
            })),
          })),
        };
      }
      // registrations collection
      return {
        where: vi.fn(() => ({
          where: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ empty: true }),
              })),
            })),
          })),
        })),
      };
    }),
    batch: vi.fn(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
  },
  storage: {
    bucket: vi.fn(() => ({
      file: vi.fn(() => ({
        save: vi.fn().mockResolvedValue(undefined),
        getSignedUrl: vi.fn().mockResolvedValue(["https://storage.example.com/badge.pdf"]),
      })),
    })),
  },
  COLLECTIONS: {
    EVENTS: "events",
    REGISTRATIONS: "registrations",
    BADGES: "badges",
    BADGE_TEMPLATES: "badgeTemplates",
  },
}));

vi.mock("pdf-lib", () => ({
  PDFDocument: { create: vi.fn() },
  rgb: vi.fn(),
  StandardFonts: { HelveticaBold: "HelveticaBold", Helvetica: "Helvetica" },
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn() },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new BadgeService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BadgeService.generate", () => {
  const orgId = "org-1";

  it("generates a badge for a confirmed registration", async () => {
    const user = buildOrganizerUser(orgId);
    const registration = buildRegistration({
      status: "confirmed",
      eventId: "ev-1",
      userId: "user-1",
    });
    const event = buildEvent({ id: "ev-1", organizationId: orgId });

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBadgeWhereGet.mockResolvedValue({ empty: true });

    const result = await service.generate(registration.id, "tpl-1", user);

    expect(result.registrationId).toBe(registration.id);
    expect(result.status).toBe("pending");
    expect(mockBadgeDocSet).toHaveBeenCalled();
  });

  it("returns existing badge instead of creating duplicate", async () => {
    const user = buildOrganizerUser(orgId);
    const registration = buildRegistration({ status: "confirmed", eventId: "ev-1" });
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    const existingBadge = {
      id: "existing-badge",
      registrationId: registration.id,
      status: "generated",
    };

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBadgeWhereGet.mockResolvedValue({
      empty: false,
      docs: [{ id: "existing-badge", data: () => existingBadge }],
    });

    const result = await service.generate(registration.id, "tpl-1", user);

    expect(result.id).toBe("existing-badge");
    expect(mockBadgeDocSet).not.toHaveBeenCalled();
  });

  it("rejects when registration status is not confirmed or checked_in", async () => {
    const user = buildOrganizerUser(orgId);
    const registration = buildRegistration({ status: "cancelled", eventId: "ev-1" });

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);

    await expect(service.generate(registration.id, "tpl-1", user)).rejects.toThrow(
      "inscriptions confirmées",
    );
  });

  it("rejects when template does not exist", async () => {
    const user = buildOrganizerUser(orgId);
    const registration = buildRegistration({ status: "confirmed", eventId: "ev-1" });

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockTemplateDocGet.mockResolvedValue({ exists: false });

    await expect(service.generate(registration.id, "tpl-missing", user)).rejects.toThrow(
      "BadgeTemplate",
    );
  });

  it("rejects user without org access to the event", async () => {
    const user = buildOrganizerUser("org-other");
    const registration = buildRegistration({ status: "confirmed", eventId: "ev-1" });
    const event = buildEvent({ id: "ev-1", organizationId: orgId });

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.generate(registration.id, "tpl-1", user)).rejects.toThrow(
      "Accès refusé aux ressources de cette organisation",
    );
  });

  it("rejects participant without badge:generate permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.generate("reg-1", "tpl-1", user)).rejects.toThrow(
      "Permission manquante : badge:generate",
    );
  });

  it("allows super_admin to generate badge for any org", async () => {
    const admin = buildSuperAdmin();
    const registration = buildRegistration({ status: "checked_in", eventId: "ev-1" });
    const event = buildEvent({ id: "ev-1", organizationId: "any-org" });

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBadgeWhereGet.mockResolvedValue({ empty: true });

    const result = await service.generate(registration.id, "tpl-1", admin);

    expect(result.status).toBe("pending");
  });
});

describe("BadgeService.bulkGenerate", () => {
  const orgId = "org-1";

  it("queues badges for confirmed registrations", async () => {
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    const registrations = [
      buildRegistration({ id: "reg-1", eventId: "ev-1", status: "confirmed" }),
      buildRegistration({ id: "reg-2", eventId: "ev-1", status: "confirmed" }),
    ];

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    // No existing badges
    mockBadgeWhereGet.mockResolvedValue({ docs: [] });
    // Return registrations on first call, empty on second
    mockRegistrationRepo.findByEventCursor
      .mockResolvedValueOnce({ data: registrations, lastDoc: null })
      .mockResolvedValueOnce({ data: [], lastDoc: null });

    const result = await service.bulkGenerate("ev-1", "tpl-1", user);

    expect(result.queued).toBe(2);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  // Note: bulkGenerate deduplication (skip existing badges) requires complex
  // Firestore collection mock chaining that is fragile in unit tests. This
  // behavior is better verified in integration tests with the Firebase emulator.

  it("rejects participant without badge:bulk_generate permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.bulkGenerate("ev-1", "tpl-1", user)).rejects.toThrow(
      "Permission manquante : badge:bulk_generate",
    );
  });

  it("rejects user without org access", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.bulkGenerate("ev-1", "tpl-1", user)).rejects.toThrow(
      "Accès refusé aux ressources de cette organisation",
    );
  });

  it("rejects when template does not exist", async () => {
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockTemplateDocGet.mockResolvedValue({ exists: false });

    await expect(service.bulkGenerate("ev-1", "tpl-missing", user)).rejects.toThrow(
      "BadgeTemplate",
    );
  });
});
