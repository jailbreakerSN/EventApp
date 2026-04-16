import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAuthUser, buildOrganizerUser, buildSuperAdmin } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockAdminRepo = {
  getPlatformStats: vi.fn(),
  listAllUsers: vi.fn(),
  listAllOrganizations: vi.fn(),
  listAllEvents: vi.fn(),
  listAuditLogs: vi.fn(),
};

vi.mock("@/repositories/admin.repository", () => ({
  adminRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockAdminRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

const mockUserDocGet = vi.fn();
const mockUserDocUpdate = vi.fn();
const mockOrgDocGet = vi.fn();
const mockOrgDocUpdate = vi.fn();

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id: string) => {
        if (name === "users") {
          return { get: mockUserDocGet, update: mockUserDocUpdate, id };
        }
        if (name === "organizations") {
          return { get: mockOrgDocGet, update: mockOrgDocUpdate, id };
        }
        return { get: vi.fn(), update: vi.fn(), id };
      }),
    })),
    runTransaction: vi.fn(),
  },
  auth: {
    setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
    updateUser: vi.fn().mockResolvedValue(undefined),
    getUser: vi.fn().mockResolvedValue({ customClaims: {} }),
  },
  COLLECTIONS: {
    USERS: "users",
    ORGANIZATIONS: "organizations",
    EVENTS: "events",
    REGISTRATIONS: "registrations",
    PAYMENTS: "payments",
    VENUES: "venues",
    AUDIT_LOGS: "auditLogs",
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Import AFTER mocks
import { adminService } from "../admin.service";
import { eventBus } from "@/events/event-bus";
import { auth } from "@/config/firebase";

// ─── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Permission denial ────────────────────────────────────────────────────

describe("AdminService — permission denial", () => {
  const participant = buildAuthUser({ roles: ["participant"] });
  const organizer = buildOrganizerUser("org-1");

  it("rejects getStats for non-super_admin", async () => {
    await expect(adminService.getStats(participant)).rejects.toThrow(
      "Permission manquante : platform:manage",
    );
  });

  it("rejects listUsers for organizer", async () => {
    await expect(adminService.listUsers(organizer, { page: 1, limit: 20 })).rejects.toThrow(
      "Permission manquante : platform:manage",
    );
  });

  it("rejects updateUserRoles for participant", async () => {
    await expect(
      adminService.updateUserRoles(participant, "some-user", ["organizer"]),
    ).rejects.toThrow("Permission manquante : platform:manage");
  });

  it("rejects updateUserStatus for organizer", async () => {
    await expect(adminService.updateUserStatus(organizer, "some-user", false)).rejects.toThrow(
      "Permission manquante : platform:manage",
    );
  });

  it("rejects listOrganizations for participant", async () => {
    await expect(
      adminService.listOrganizations(participant, { page: 1, limit: 20 }),
    ).rejects.toThrow("Permission manquante : platform:manage");
  });

  it("rejects verifyOrganization for organizer", async () => {
    await expect(adminService.verifyOrganization(organizer, "org-1")).rejects.toThrow(
      "Permission manquante : platform:manage",
    );
  });

  it("rejects listEvents for participant", async () => {
    await expect(adminService.listEvents(participant, { page: 1, limit: 20 })).rejects.toThrow(
      "Permission manquante : platform:manage",
    );
  });

  it("rejects listAuditLogs for organizer", async () => {
    await expect(adminService.listAuditLogs(organizer, { page: 1, limit: 20 })).rejects.toThrow(
      "Permission manquante : platform:manage",
    );
  });
});

// ── getStats ─────────────────────────────────────────────────────────────

describe("AdminService.getStats", () => {
  it("returns platform stats for super_admin", async () => {
    const admin = buildSuperAdmin();
    const stats = {
      totalUsers: 100,
      totalOrganizations: 10,
      totalEvents: 50,
      totalRegistrations: 500,
      totalRevenue: 2500000,
      activeVenues: 5,
    };
    mockAdminRepo.getPlatformStats.mockResolvedValue(stats);

    const result = await adminService.getStats(admin);

    expect(result).toEqual(stats);
    expect(mockAdminRepo.getPlatformStats).toHaveBeenCalledOnce();
  });
});

// ── listUsers ────────────────────────────────────────────────────────────

describe("AdminService.listUsers", () => {
  const BASE_PROFILE = {
    uid: "user-1",
    email: "test@test.com",
    displayName: "Test",
    roles: ["participant"],
    organizationId: null,
    orgRole: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("returns paginated user list for super_admin", async () => {
    const admin = buildSuperAdmin();
    mockAdminRepo.listAllUsers.mockResolvedValue({
      data: [BASE_PROFILE],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const result = await adminService.listUsers(admin, { page: 1, limit: 20, role: "participant" });

    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(mockAdminRepo.listAllUsers).toHaveBeenCalledWith(
      expect.objectContaining({ role: "participant" }),
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it("attaches claimsMatch showing all fields in sync when JWT equals Firestore", async () => {
    const admin = buildSuperAdmin();
    mockAdminRepo.listAllUsers.mockResolvedValue({
      data: [{ ...BASE_PROFILE, roles: ["organizer"], organizationId: "org-1" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(auth.getUser).mockResolvedValueOnce({
      customClaims: { roles: ["organizer"], organizationId: "org-1" },
    } as never);

    const result = await adminService.listUsers(admin, { page: 1, limit: 20 });

    expect(result.data[0].claimsMatch).toEqual({
      roles: true,
      organizationId: true,
      orgRole: true,
    });
  });

  it("flags drift when Firestore roles differ from JWT custom claims", async () => {
    // Regression guard for MEDIUM-3: admin UI was showing Firestore
    // state while permissions ran on JWT. The listUsers endpoint must
    // now expose the comparison so the UI can render a warning badge.
    const admin = buildSuperAdmin();
    mockAdminRepo.listAllUsers.mockResolvedValue({
      data: [{ ...BASE_PROFILE, roles: ["organizer"], organizationId: "org-1" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(auth.getUser).mockResolvedValueOnce({
      // JWT still carries the old participant role — the classic
      // mid-failure drift PR #65 aims to heal. Guard ensures we surface it.
      customClaims: { roles: ["participant"], organizationId: "org-1" },
    } as never);

    const result = await adminService.listUsers(admin, { page: 1, limit: 20 });

    expect(result.data[0].claimsMatch).toEqual({
      roles: false,
      organizationId: true,
      orgRole: true,
    });
  });

  it("treats role arrays as sets — order difference is not drift", async () => {
    const admin = buildSuperAdmin();
    mockAdminRepo.listAllUsers.mockResolvedValue({
      data: [{ ...BASE_PROFILE, roles: ["organizer", "participant"] }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(auth.getUser).mockResolvedValueOnce({
      customClaims: { roles: ["participant", "organizer"] },
    } as never);

    const result = await adminService.listUsers(admin, { page: 1, limit: 20 });

    expect(result.data[0].claimsMatch?.roles).toBe(true);
  });

  it("returns claimsMatch=null when the Auth record can't be fetched", async () => {
    // Auth-record-missing (user deleted in Auth, doc lingers) — UI
    // treats this as drift too so the admin notices the orphan.
    const admin = buildSuperAdmin();
    mockAdminRepo.listAllUsers.mockResolvedValue({
      data: [BASE_PROFILE],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(auth.getUser).mockRejectedValueOnce(new Error("user-not-found"));

    const result = await adminService.listUsers(admin, { page: 1, limit: 20 });

    expect(result.data[0].claimsMatch).toBeNull();
  });
});

// ── listOrganizations ────────────────────────────────────────────────────

describe("AdminService.listOrganizations", () => {
  it("returns paginated organization list for super_admin", async () => {
    const admin = buildSuperAdmin();
    const paginatedResult = {
      data: [{ id: "org-1", name: "Test Org", plan: "free" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    mockAdminRepo.listAllOrganizations.mockResolvedValue(paginatedResult);

    const result = await adminService.listOrganizations(admin, {
      page: 1,
      limit: 20,
      plan: "free",
    });

    expect(result.data).toHaveLength(1);
    expect(mockAdminRepo.listAllOrganizations).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "free" }),
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });
});

// ── updateUserRoles ──────────────────────────────────────────────────────

describe("AdminService.updateUserRoles", () => {
  it("updates roles in Firestore and Auth custom claims", async () => {
    const admin = buildSuperAdmin();
    const targetUserId = "target-user-123";

    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ roles: ["participant"], organizationId: "org-1" }),
    });
    mockUserDocUpdate.mockResolvedValue(undefined);

    await adminService.updateUserRoles(admin, targetUserId, ["organizer"]);

    expect(mockUserDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: ["organizer"],
      }),
    );
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(targetUserId, {
      roles: ["organizer"],
      organizationId: "org-1",
    });
  });

  it("emits user.role_changed domain event", async () => {
    const admin = buildSuperAdmin();
    const targetUserId = "target-user-456";

    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ roles: ["participant"], organizationId: undefined }),
    });
    mockUserDocUpdate.mockResolvedValue(undefined);

    await adminService.updateUserRoles(admin, targetUserId, ["organizer"]);

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.role_changed",
      expect.objectContaining({
        actorId: admin.uid,
        targetUserId,
        oldRoles: ["participant"],
        newRoles: ["organizer"],
      }),
    );
  });

  it("rejects self-demotion from super_admin", async () => {
    const admin = buildSuperAdmin();

    await expect(adminService.updateUserRoles(admin, admin.uid, ["organizer"])).rejects.toThrow(
      "Impossible de retirer votre propre rôle super_admin",
    );
  });

  it("allows self-update that retains super_admin role", async () => {
    const admin = buildSuperAdmin();

    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ roles: ["super_admin"], organizationId: undefined }),
    });
    mockUserDocUpdate.mockResolvedValue(undefined);

    await expect(
      adminService.updateUserRoles(admin, admin.uid, ["super_admin", "organizer"]),
    ).resolves.not.toThrow();
  });

  it("throws NotFoundError when target user does not exist", async () => {
    const admin = buildSuperAdmin();
    mockUserDocGet.mockResolvedValue({ exists: false });

    await expect(
      adminService.updateUserRoles(admin, "nonexistent-user", ["organizer"]),
    ).rejects.toThrow("introuvable");
  });
});

// ── updateUserStatus ─────────────────────────────────────────────────────

describe("AdminService.updateUserStatus", () => {
  it("suspends a user in Firestore and Firebase Auth", async () => {
    const admin = buildSuperAdmin();
    const targetUserId = "target-user-789";

    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ isActive: true }),
    });
    mockUserDocUpdate.mockResolvedValue(undefined);

    await adminService.updateUserStatus(admin, targetUserId, false);

    expect(mockUserDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    expect(auth.updateUser).toHaveBeenCalledWith(targetUserId, { disabled: true });
  });

  it("reactivates a user", async () => {
    const admin = buildSuperAdmin();
    const targetUserId = "target-user-reactivate";

    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ isActive: false }),
    });
    mockUserDocUpdate.mockResolvedValue(undefined);

    await adminService.updateUserStatus(admin, targetUserId, true);

    expect(auth.updateUser).toHaveBeenCalledWith(targetUserId, { disabled: false });
  });

  it("rejects self-suspension", async () => {
    const admin = buildSuperAdmin();

    await expect(adminService.updateUserStatus(admin, admin.uid, false)).rejects.toThrow(
      "Impossible de suspendre votre propre compte",
    );
  });

  it("throws NotFoundError when target user does not exist", async () => {
    const admin = buildSuperAdmin();
    mockUserDocGet.mockResolvedValue({ exists: false });

    await expect(adminService.updateUserStatus(admin, "ghost-user", false)).rejects.toThrow(
      "introuvable",
    );
  });

  it("emits user.status_changed domain event", async () => {
    const admin = buildSuperAdmin();
    const targetUserId = "target-user-status";

    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ isActive: true }),
    });
    mockUserDocUpdate.mockResolvedValue(undefined);

    await adminService.updateUserStatus(admin, targetUserId, false);

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.status_changed",
      expect.objectContaining({
        actorId: admin.uid,
        targetUserId,
        isActive: false,
      }),
    );
  });
});

// ── Class C: dual-write rollback regression guards ───────────────────────
//
// PR #59 fixed onUserCreated drift between Firestore and Auth claims; these
// guards close the same vector on the admin write path. If the second write
// (Auth) fails after the first (Firestore) committed, the service must
// roll the Firestore write back so the operator never sees admin UI showing
// roles/status that the JWT doesn't carry.

describe("AdminService.updateUserRoles — claims-failure rollback (Class C)", () => {
  it("rolls Firestore back to oldRoles when setCustomUserClaims fails", async () => {
    const admin = buildSuperAdmin();
    const targetUserId = "drift-victim-1";

    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ roles: ["participant"], organizationId: "org-1" }),
    });
    // First update (forward) succeeds, second update (rollback) succeeds.
    mockUserDocUpdate.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    vi.mocked(auth.setCustomUserClaims).mockRejectedValueOnce(new Error("Auth API down"));

    await expect(adminService.updateUserRoles(admin, targetUserId, ["organizer"])).rejects.toThrow(
      "Auth API down",
    );

    // Two update calls: forward then compensating rollback.
    expect(mockUserDocUpdate).toHaveBeenCalledTimes(2);
    expect(mockUserDocUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ roles: ["organizer"] }),
    );
    expect(mockUserDocUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ roles: ["participant"] }),
    );
    // Crucially: no domain event fired since the operation didn't succeed
    // — listeners would have produced a misleading audit row.
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("surfaces the original Auth error when the compensating rollback also fails", async () => {
    const admin = buildSuperAdmin();
    const targetUserId = "drift-victim-2";

    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ roles: ["participant"], organizationId: null }),
    });
    mockUserDocUpdate
      .mockResolvedValueOnce(undefined) // forward write succeeds
      .mockRejectedValueOnce(new Error("Firestore rollback also down")); // rollback fails
    vi.mocked(auth.setCustomUserClaims).mockRejectedValueOnce(new Error("Auth API down"));

    // The operator must see the AUTH error (the cause), not the
    // secondary rollback error — that's what tells them to retry.
    await expect(adminService.updateUserRoles(admin, targetUserId, ["organizer"])).rejects.toThrow(
      "Auth API down",
    );
  });
});

describe("AdminService.updateUserStatus — auth-failure rollback (Class C)", () => {
  it("rolls Firestore back to previousIsActive when auth.updateUser fails", async () => {
    const admin = buildSuperAdmin();
    const targetUserId = "drift-victim-3";

    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ isActive: true }),
    });
    mockUserDocUpdate.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    vi.mocked(auth.updateUser).mockRejectedValueOnce(new Error("Auth disable failed"));

    await expect(adminService.updateUserStatus(admin, targetUserId, false)).rejects.toThrow(
      "Auth disable failed",
    );

    expect(mockUserDocUpdate).toHaveBeenCalledTimes(2);
    expect(mockUserDocUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ isActive: false }),
    );
    expect(mockUserDocUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ isActive: true }),
    );
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("surfaces the original Auth error when the compensating rollback also fails", async () => {
    const admin = buildSuperAdmin();
    const targetUserId = "drift-victim-4";

    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ isActive: true }),
    });
    mockUserDocUpdate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Firestore rollback also down"));
    vi.mocked(auth.updateUser).mockRejectedValueOnce(new Error("Auth disable failed"));

    await expect(adminService.updateUserStatus(admin, targetUserId, false)).rejects.toThrow(
      "Auth disable failed",
    );
  });
});

// ── verifyOrganization ───────────────────────────────────────────────────

describe("AdminService.verifyOrganization", () => {
  it("sets isVerified to true and emits domain event", async () => {
    const admin = buildSuperAdmin();
    mockOrgDocGet.mockResolvedValue({ exists: true, data: () => ({ isVerified: false }) });
    mockOrgDocUpdate.mockResolvedValue(undefined);

    await adminService.verifyOrganization(admin, "org-to-verify");

    expect(mockOrgDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ isVerified: true }));
    expect(eventBus.emit).toHaveBeenCalledWith(
      "organization.verified",
      expect.objectContaining({
        actorId: admin.uid,
        organizationId: "org-to-verify",
      }),
    );
  });

  it("throws NotFoundError for non-existent organization", async () => {
    const admin = buildSuperAdmin();
    mockOrgDocGet.mockResolvedValue({ exists: false });

    await expect(adminService.verifyOrganization(admin, "nonexistent-org")).rejects.toThrow(
      "introuvable",
    );
  });
});

// ── listEvents ───────────────────────────────────────────────────────────

describe("AdminService.listEvents", () => {
  it("returns paginated events for super_admin", async () => {
    const admin = buildSuperAdmin();
    const paginatedResult = {
      data: [{ id: "ev-1", title: "Test Event" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    mockAdminRepo.listAllEvents.mockResolvedValue(paginatedResult);

    const result = await adminService.listEvents(admin, {
      page: 1,
      limit: 20,
      status: "published",
    });

    expect(result.data).toHaveLength(1);
    expect(mockAdminRepo.listAllEvents).toHaveBeenCalledWith(
      expect.objectContaining({ status: "published" }),
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });
});

// ── listAuditLogs ────────────────────────────────────────────────────────

describe("AdminService.listAuditLogs", () => {
  it("returns paginated audit logs for super_admin", async () => {
    const admin = buildSuperAdmin();
    const paginatedResult = {
      data: [{ id: "log-1", action: "event.created", actorId: "user-1" }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    mockAdminRepo.listAuditLogs.mockResolvedValue(paginatedResult);

    const result = await adminService.listAuditLogs(admin, {
      page: 1,
      limit: 20,
      action: "event.created",
    });

    expect(result.data).toHaveLength(1);
    expect(mockAdminRepo.listAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ action: "event.created" }),
      expect.objectContaining({ page: 1, limit: 20, orderBy: "timestamp", orderDir: "desc" }),
    );
  });
});

// ── Super admin access ───────────────────────────────────────────────────

describe("AdminService — super_admin can access all methods", () => {
  const admin = buildSuperAdmin();

  it("can call getStats", async () => {
    mockAdminRepo.getPlatformStats.mockResolvedValue({
      totalUsers: 0,
      totalOrganizations: 0,
      totalEvents: 0,
      totalRegistrations: 0,
      totalRevenue: 0,
      activeVenues: 0,
    });

    await expect(adminService.getStats(admin)).resolves.toBeDefined();
  });

  it("can call listUsers", async () => {
    mockAdminRepo.listAllUsers.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await expect(adminService.listUsers(admin, { page: 1, limit: 20 })).resolves.toBeDefined();
  });

  it("can call listOrganizations", async () => {
    mockAdminRepo.listAllOrganizations.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await expect(
      adminService.listOrganizations(admin, { page: 1, limit: 20 }),
    ).resolves.toBeDefined();
  });

  it("can call listEvents", async () => {
    mockAdminRepo.listAllEvents.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await expect(adminService.listEvents(admin, { page: 1, limit: 20 })).resolves.toBeDefined();
  });

  it("can call listAuditLogs", async () => {
    mockAdminRepo.listAuditLogs.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await expect(adminService.listAuditLogs(admin, { page: 1, limit: 20 })).resolves.toBeDefined();
  });
});
