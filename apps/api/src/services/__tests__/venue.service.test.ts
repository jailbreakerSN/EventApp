import { describe, it, expect, vi, beforeEach } from "vitest";
import { VenueService } from "../venue.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildSuperAdmin,
  buildVenue,
} from "@/__tests__/factories";
import { type CreateVenueDto, type UpdateVenueDto } from "@teranga/shared-types";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockVenueRepo = {
  create: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findBySlug: vi.fn(),
  findApproved: vi.fn(),
  findByHost: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/repositories/venue.repository", () => ({
  venueRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockVenueRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

const mockCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) });
const mockQueryGet = vi.fn().mockResolvedValue({ docs: [] });

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      where: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            offset: vi.fn(() => ({
              limit: vi.fn(() => ({ get: mockQueryGet })),
            })),
          })),
          count: vi.fn(() => ({ get: mockCountGet })),
        })),
        orderBy: vi.fn(() => ({
          offset: vi.fn(() => ({
            limit: vi.fn(() => ({ get: mockQueryGet })),
          })),
        })),
        count: vi.fn(() => ({ get: mockCountGet })),
      })),
    })),
  },
  COLLECTIONS: { EVENTS: "events", VENUES: "venues" },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new VenueService();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VenueService.create", () => {
  const dto: CreateVenueDto = {
    name: "CICAD Diamniadio",
    description: "Centre de conférences",
    address: { street: "Autoroute à péage", city: "Diamniadio", country: "SN" },
    venueType: "conference_center",
    capacity: { min: 100, max: 2000, configurations: [] },
    amenities: ["wifi", "parking"],
    photos: [],
    contactName: "Admin",
    contactEmail: "admin@cicad.sn",
    contactPhone: null,
    website: null,
    hostOrganizationId: null,
  };

  it("creates a venue with auto-generated slug and emits event", async () => {
    const user = buildSuperAdmin();
    const created = buildVenue({ name: "CICAD Diamniadio" });
    mockVenueRepo.create.mockResolvedValue(created);

    const result = await service.create(dto, user);

    expect(result.name).toBe("CICAD Diamniadio");
    expect(mockVenueRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: expect.stringMatching(/^cicad-diamniadio-[a-f0-9]{6}$/),
        createdBy: user.uid,
        updatedBy: user.uid,
        isFeatured: false,
        rating: null,
        eventCount: 0,
      }),
    );
  });

  it("auto-approves venue when created by super_admin", async () => {
    const admin = buildSuperAdmin();
    mockVenueRepo.create.mockResolvedValue(buildVenue());

    await service.create(dto, admin);

    expect(mockVenueRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved" }),
    );
  });

  it("rejects organizer without venue:create permission", async () => {
    const user = buildOrganizerUser("org-1");

    await expect(service.create(dto, user)).rejects.toThrow("Permission venue:create requise");
  });

  it("rejects participant without venue:create permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.create(dto, user)).rejects.toThrow("Permission venue:create requise");
  });
});

describe("VenueService.update", () => {
  it("allows owner to update their venue", async () => {
    const user = buildOrganizerUser("org-1");
    const venue = buildVenue({ hostOrganizationId: "org-1" });
    mockVenueRepo.findByIdOrThrow.mockResolvedValue(venue);
    mockVenueRepo.update.mockResolvedValue(undefined);

    await service.update(venue.id, { name: "Updated Name" } as UpdateVenueDto, user);

    expect(mockVenueRepo.update).toHaveBeenCalledWith(
      venue.id,
      expect.objectContaining({ name: "Updated Name", updatedBy: user.uid }),
    );
  });

  it("allows admin to update any venue", async () => {
    const admin = buildSuperAdmin();
    const venue = buildVenue({ hostOrganizationId: "org-other" });
    mockVenueRepo.findByIdOrThrow.mockResolvedValue(venue);
    mockVenueRepo.update.mockResolvedValue(undefined);

    await service.update(venue.id, { name: "Admin Edit" } as UpdateVenueDto, admin);

    expect(mockVenueRepo.update).toHaveBeenCalledWith(
      venue.id,
      expect.objectContaining({ name: "Admin Edit" }),
    );
  });

  it("rejects non-owner without admin permission", async () => {
    const user = buildOrganizerUser("org-1");
    const venue = buildVenue({ hostOrganizationId: "org-other" });
    mockVenueRepo.findByIdOrThrow.mockResolvedValue(venue);

    await expect(
      service.update(venue.id, { name: "Nope" } as UpdateVenueDto, user),
    ).rejects.toThrow("Accès refusé à ce lieu");
  });
});

describe("VenueService.approve", () => {
  it("approves a pending venue and emits event", async () => {
    const admin = buildSuperAdmin();
    const venue = buildVenue({ status: "pending" });
    mockVenueRepo.findByIdOrThrow.mockResolvedValue(venue);
    mockVenueRepo.update.mockResolvedValue(undefined);

    await service.approve(venue.id, admin);

    expect(mockVenueRepo.update).toHaveBeenCalledWith(
      venue.id,
      expect.objectContaining({ status: "approved", updatedBy: admin.uid }),
    );
  });

  it("rejects approving a non-pending venue", async () => {
    const admin = buildSuperAdmin();
    const venue = buildVenue({ status: "approved" });
    mockVenueRepo.findByIdOrThrow.mockResolvedValue(venue);

    await expect(service.approve(venue.id, admin)).rejects.toThrow(
      "Impossible d'approuver un lieu avec le statut",
    );
  });

  it("rejects participant without venue:approve permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.approve("venue-1", user)).rejects.toThrow("Permission manquante");
  });
});

describe("VenueService.suspend", () => {
  it("suspends an approved venue", async () => {
    const admin = buildSuperAdmin();
    const venue = buildVenue({ status: "approved" });
    mockVenueRepo.findByIdOrThrow.mockResolvedValue(venue);
    mockVenueRepo.update.mockResolvedValue(undefined);

    await service.suspend(venue.id, admin);

    expect(mockVenueRepo.update).toHaveBeenCalledWith(
      venue.id,
      expect.objectContaining({ status: "suspended" }),
    );
  });

  it("rejects suspending an already suspended venue", async () => {
    const admin = buildSuperAdmin();
    const venue = buildVenue({ status: "suspended" });
    mockVenueRepo.findByIdOrThrow.mockResolvedValue(venue);

    await expect(service.suspend(venue.id, admin)).rejects.toThrow("déjà suspendu");
  });

  it("rejects user without venue:manage_all permission", async () => {
    const user = buildOrganizerUser("org-1");

    await expect(service.suspend("venue-1", user)).rejects.toThrow("Permission manquante");
  });
});

describe("VenueService.reactivate", () => {
  it("reactivates a suspended venue", async () => {
    const admin = buildSuperAdmin();
    const venue = buildVenue({ status: "suspended" });
    mockVenueRepo.findByIdOrThrow.mockResolvedValue(venue);
    mockVenueRepo.update.mockResolvedValue(undefined);

    await service.reactivate(venue.id, admin);

    expect(mockVenueRepo.update).toHaveBeenCalledWith(
      venue.id,
      expect.objectContaining({ status: "approved" }),
    );
  });

  it("rejects reactivating a non-suspended venue", async () => {
    const admin = buildSuperAdmin();
    const venue = buildVenue({ status: "approved" });
    mockVenueRepo.findByIdOrThrow.mockResolvedValue(venue);

    await expect(service.reactivate(venue.id, admin)).rejects.toThrow("Seuls les lieux suspendus");
  });
});

describe("VenueService.listPublic", () => {
  it("delegates to repository findApproved", async () => {
    const venues = [buildVenue(), buildVenue()];
    mockVenueRepo.findApproved.mockResolvedValue({
      data: venues,
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });

    const result = await service.listPublic({
      page: 1,
      limit: 20,
      orderBy: "name",
      orderDir: "asc",
    });

    expect(result.data).toHaveLength(2);
    expect(mockVenueRepo.findApproved).toHaveBeenCalled();
  });
});

describe("VenueService.listHostVenues", () => {
  it("returns venues for user's organization", async () => {
    const user = buildOrganizerUser("org-1");
    mockVenueRepo.findByHost.mockResolvedValue({
      data: [buildVenue()],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    const result = await service.listHostVenues(user);

    expect(result.data).toHaveLength(1);
    expect(mockVenueRepo.findByHost).toHaveBeenCalledWith("org-1", expect.any(Object));
  });

  it("rejects user without organizationId", async () => {
    const user = buildAuthUser({ roles: ["participant"], organizationId: undefined });

    await expect(service.listHostVenues(user)).rejects.toThrow(
      "Vous devez appartenir à une organisation",
    );
  });
});
