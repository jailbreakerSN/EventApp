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
// Phase 4 — capture impersonation audit-log appends for assertions.
export const mockAuditAdd = vi.fn().mockResolvedValue({ id: "audit-doc-fake" });

// The impersonation auth-code flow writes to a new collection
// (`impersonationCodes`). Stub the writer so assertions can capture
// what landed on the doc without bringing up an emulator.
export const mockImpersonationCodeSet = vi.fn().mockResolvedValue(undefined);

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
        if (name === "impersonationCodes") {
          return { set: mockImpersonationCodeSet, id };
        }
        return { get: vi.fn(), update: vi.fn(), id };
      }),
      // Admin impersonation appends a new audit doc; capture via spy.
      add: name === "auditLogs" ? mockAuditAdd : vi.fn(),
    })),
    // Route tx.get / tx.update on user/org docs to the same spies as
    // non-tx writes so existing assertions keep working after the
    // Class-C transactional hardening (updateUserRoles / updateUserStatus
    // now read-then-write inside runTransaction).
    runTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        get: (ref: { get: () => unknown }) => ref.get(),
        update: (ref: { update: (data: unknown) => unknown }, data: unknown) => ref.update(data),
        set: vi.fn(),
      };
      return cb(tx);
    }),
  },
  auth: {
    setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
    updateUser: vi.fn().mockResolvedValue(undefined),
    getUser: vi.fn().mockResolvedValue({ customClaims: {} }),
    // Phase 4 — impersonation mints a custom token. The mock returns a
    // stable string so tests can assert what flows to the UI.
    createCustomToken: vi.fn().mockResolvedValue("mock-custom-token"),
    revokeRefreshTokens: vi.fn().mockResolvedValue(undefined),
  },
  COLLECTIONS: {
    USERS: "users",
    ORGANIZATIONS: "organizations",
    EVENTS: "events",
    REGISTRATIONS: "registrations",
    PAYMENTS: "payments",
    VENUES: "venues",
    AUDIT_LOGS: "auditLogs",
    SUBSCRIPTIONS: "subscriptions",
    INVITES: "invites",
    FEATURE_FLAGS: "featureFlags",
    IMPERSONATION_CODES: "impersonationCodes",
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
  // `clearAllMocks` only wipes call history. The per-test
  // `mockResolvedValueOnce` queue lives on the fn until it's
  // explicitly reset — so if one test queues two values but the
  // service short-circuits after the first, the second leaks into
  // the next test. mockReset() drops both call history AND the
  // .*Once queue, then we reinstate any baseline returns this file
  // depends on for un-queued reads.
  mockUserDocGet.mockReset();
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

  it("skips the drift signal for fresh users whose claims haven't propagated yet", async () => {
    // Regression guard for BUG-2: onUserCreated trigger runs async after
    // Auth user creation, so a brand-new account has no customClaims
    // yet for ~seconds-to-minutes. Without the grace window, EVERY new
    // user lights up an ⚠ JWT pill on first admin-page load, training
    // operators to ignore the warning.
    const admin = buildSuperAdmin();
    const justCreated = { ...BASE_PROFILE, createdAt: new Date().toISOString() };
    mockAdminRepo.listAllUsers.mockResolvedValue({
      data: [justCreated],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(auth.getUser).mockResolvedValueOnce({
      customClaims: undefined, // trigger hasn't set claims yet
    } as never);

    const result = await adminService.listUsers(admin, { page: 1, limit: 20 });

    expect(result.data[0].claimsMatch).toEqual({
      roles: true,
      organizationId: true,
      orgRole: true,
    });
  });

  it("still flags drift for OLD users with empty claims (outside grace window)", async () => {
    // Complement to the grace test: empty claims on a doc that's been
    // around for 2 hours is a real drift (the trigger should have fired
    // long ago). Must NOT get suppressed by the grace window.
    const admin = buildSuperAdmin();
    const old = {
      ...BASE_PROFILE,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      roles: ["organizer"],
    };
    mockAdminRepo.listAllUsers.mockResolvedValue({
      data: [old],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    vi.mocked(auth.getUser).mockResolvedValueOnce({
      customClaims: {},
    } as never);

    const result = await adminService.listUsers(admin, { page: 1, limit: 20 });

    // Roles drift — empty claim roles vs doc's ["organizer"].
    expect(result.data[0].claimsMatch?.roles).toBe(false);
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

// ─── Phase 4 — Impersonation ─────────────────────────────────────────────
// Covers every permission rail on startImpersonation() since it is the
// highest-privilege action in the admin surface:
//  - happy path (super_admin → participant): mints a token, writes audit
//    *before* returning, emits domain event.
//  - non-super_admin callers are rejected.
//  - self-impersonation is rejected.
//  - impersonating another super_admin is rejected (privilege-escalation
//    chain prevention).
//  - missing target user surfaces a 404-shaped error.

describe("AdminService.startImpersonation (OAuth-style auth-code flow)", () => {
  const admin = buildSuperAdmin();

  const participantTarget = {
    uid: "user-participant",
    email: "alice@teranga.dev",
    displayName: "Alice Dupont",
    roles: ["participant"],
    organizationId: "org-001",
    orgRole: "member",
  };

  // The service under test now reads TWO user docs per issue — the
  // target (to validate + stamp audit metadata) and the admin (to
  // surface their displayName to the accept-banner). Queue both in
  // order via mockUserDocGet to keep the fixtures readable.
  function mockIssueDocs(
    targetData: unknown,
    targetExists = true,
    actorDisplayName = "Admin Tester",
  ) {
    mockUserDocGet.mockResolvedValueOnce({ exists: targetExists, data: () => targetData });
    mockUserDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ displayName: actorDisplayName }),
    });
  }

  it("issues an auth code, writes the issue audit row, emits domain event, returns acceptUrl", async () => {
    mockIssueDocs(participantTarget);

    const res = await adminService.startImpersonation(admin, participantTarget.uid, {
      ip: "203.0.113.7",
      ua: "Jest/Tests",
    });

    // Response carries the opaque code + absolute acceptUrl — NOT a
    // Firebase custom token. The token is minted at exchange time,
    // server-side, and travels back over HTTPS body only.
    expect(res).not.toHaveProperty("customToken");
    expect(res.code).toHaveLength(43); // 32 bytes, base64url-encoded
    expect(res.acceptUrl).toMatch(/\/impersonation\/accept\?code=/);
    // The code appears in the URL but never in a custom Firebase token here.
    expect(res.acceptUrl).toContain(`code=${encodeURIComponent(res.code)}`);
    expect(res.targetUid).toBe(participantTarget.uid);
    expect(res.targetDisplayName).toBe(participantTarget.displayName);
    expect(res.targetOrigin).toMatch(/^https?:\/\//);
    expect(res.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Crucially: no token signing at issue time. signBlob IAM paths
    // (and any Firebase costs) shift to the exchange step.
    expect(auth.createCustomToken).not.toHaveBeenCalled();

    // Audit log is written SYNCHRONOUSLY and tagged with the new
    // `flow: "auth_code"` discriminator so the timeline distinguishes
    // OAuth-style issues from legacy direct-token rows. IP + UA are
    // stamped on the row itself (not just the ephemeral code doc) so
    // SOC-2 investigators reading only auditLogs have the admin's
    // session fingerprint without cross-referencing the 60s-TTL
    // impersonationCodes collection.
    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.impersonated",
        actorId: admin.uid,
        resourceType: "user",
        resourceId: participantTarget.uid,
        details: expect.objectContaining({
          flow: "auth_code",
          issueIp: "203.0.113.7",
          issueUa: "Jest/Tests",
        }),
      }),
    );

    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.impersonated",
      expect.objectContaining({ actorUid: admin.uid, targetUid: participantTarget.uid }),
    );
  });

  it("rejects non-super_admin callers with a ForbiddenError", async () => {
    const orgAdmin = buildAuthUser({ uid: "u-non-super", roles: ["organizer"] });
    // No doc read is reached since the gate trips first.
    await expect(
      adminService.startImpersonation(orgAdmin, participantTarget.uid),
    ).rejects.toThrow();
    expect(auth.createCustomToken).not.toHaveBeenCalled();
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });

  it("refuses self-impersonation", async () => {
    await expect(adminService.startImpersonation(admin, admin.uid)).rejects.toThrow(
      /Cannot impersonate yourself/i,
    );
    expect(auth.createCustomToken).not.toHaveBeenCalled();
  });

  it("refuses impersonating another super_admin", async () => {
    mockIssueDocs({
      ...participantTarget,
      uid: "another-super",
      roles: ["super_admin"],
    });
    await expect(adminService.startImpersonation(admin, "another-super")).rejects.toThrow(
      /another super_admin/i,
    );
    expect(auth.createCustomToken).not.toHaveBeenCalled();
    // Audit MUST NOT be written because the precondition failed.
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });

  it("refuses impersonating a platform:super_admin (top-tier parity)", async () => {
    // Closure I hygiene — both legacy super_admin and the granular
    // platform:super_admin are top-tier. The target guard must reject
    // both classes symmetrically so the audit trail always ends on the
    // highest-privilege admin.
    mockIssueDocs({
      ...participantTarget,
      uid: "another-top-admin",
      roles: ["platform:super_admin"],
    });
    await expect(adminService.startImpersonation(admin, "another-top-admin")).rejects.toThrow(
      /another super_admin/i,
    );
    expect(auth.createCustomToken).not.toHaveBeenCalled();
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the target user doc does not exist", async () => {
    mockIssueDocs(undefined, false);
    await expect(adminService.startImpersonation(admin, "ghost-user")).rejects.toThrow();
    expect(auth.createCustomToken).not.toHaveBeenCalled();
  });

  it("accepts a platform:super_admin caller and stamps that role on the audit row", async () => {
    const platformSuper = buildAuthUser({
      uid: "u-platform-super",
      roles: ["platform:super_admin"],
    });
    mockIssueDocs(participantTarget);

    await adminService.startImpersonation(platformSuper, participantTarget.uid);

    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.impersonated",
        actorId: platformSuper.uid,
        actorRole: "platform:super_admin",
      }),
    );
  });

  it("refuses platform:support (and other non-super platform:* roles)", async () => {
    // platform:support holds platform:manage (so passes requirePermission)
    // but MUST NOT be allowed to impersonate — impersonation is the most
    // sensitive action on the platform, gated to super_admin tier only.
    const support = buildAuthUser({ uid: "u-support", roles: ["platform:support"] });
    // Target doc is NOT reached since the role gate trips first.
    await expect(adminService.startImpersonation(support, participantTarget.uid)).rejects.toThrow(
      /Only super_admin may impersonate/i,
    );
    expect(auth.createCustomToken).not.toHaveBeenCalled();
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });
});

// Covers the session-exit path. `endImpersonation` relies on the signed
// `impersonatedBy` claim extracted by auth.middleware.ts. These tests
// guard the three branches:
//  - happy path: claim matches actorUid → revoke + audit.
//  - missing claim: caller is not actually inside an impersonation session.
//  - claim mismatch: another admin's session — must NOT be endable.

describe("AdminService.endImpersonation (Phase 4)", () => {
  const adminUid = "admin-super-1";
  const targetUid = "user-participant-7";

  it("revokes the impersonated user's refresh tokens, stamps super_admin, emits event", async () => {
    // Simulate the middleware: `impersonatedBy` populated from a valid
    // session token minted by startImpersonation for targetUid.
    const caller = buildAuthUser({
      uid: targetUid,
      roles: ["participant"],
      impersonatedBy: adminUid,
    });
    // Closure I — endImpersonation looks up the admin's doc to stamp
    // the correct actorRole on the audit record.
    mockUserDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ uid: adminUid, roles: ["super_admin"] }),
    });

    await adminService.endImpersonation(caller, adminUid);

    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith(targetUid);
    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.impersonation_ended",
        actorId: adminUid,
        actorRole: "super_admin",
        resourceType: "user",
        resourceId: targetUid,
        details: expect.objectContaining({ actorRoleLookup: "firestore" }),
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      "user.impersonation_ended",
      expect.objectContaining({ actorUid: adminUid, targetUid }),
    );
  });

  it("stamps platform:super_admin when the actor holds that granular role", async () => {
    const caller = buildAuthUser({
      uid: targetUid,
      roles: ["participant"],
      impersonatedBy: adminUid,
    });
    mockUserDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ uid: adminUid, roles: ["platform:super_admin"] }),
    });

    await adminService.endImpersonation(caller, adminUid);

    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: "platform:super_admin" }),
    );
  });

  it("falls back to super_admin + flags lookup when the admin doc is missing", async () => {
    const caller = buildAuthUser({
      uid: targetUid,
      roles: ["participant"],
      impersonatedBy: adminUid,
    });
    // Lookup throws — mimics a demoted admin mid-session or Firestore hiccup.
    mockUserDocGet.mockRejectedValueOnce(new Error("firestore unavailable"));

    await adminService.endImpersonation(caller, adminUid);

    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        actorRole: "super_admin",
        details: expect.objectContaining({ actorRoleLookup: "fallback" }),
      }),
    );
  });

  it("rejects callers whose session has no impersonatedBy claim", async () => {
    // Regular (non-impersonating) session — the claim is missing entirely.
    const caller = buildAuthUser({ uid: "regular-user", roles: ["participant"] });

    await expect(adminService.endImpersonation(caller, adminUid)).rejects.toThrow(
      /Session d'impersonation non reconnue/i,
    );

    // No side effects: nothing was revoked, nothing was audited.
    expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(mockAuditAdd).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("rejects when the actorUid param does not match the signed claim", async () => {
    // Session minted by admin-A but the client posts admin-B's uid —
    // a tampered breadcrumb. Must refuse before revoking anything.
    const caller = buildAuthUser({
      uid: targetUid,
      roles: ["participant"],
      impersonatedBy: "admin-A",
    });

    await expect(adminService.endImpersonation(caller, "admin-B")).rejects.toThrow(
      /Session d'impersonation non reconnue/i,
    );

    expect(auth.revokeRefreshTokens).not.toHaveBeenCalled();
    expect(mockAuditAdd).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("propagates revokeRefreshTokens failure and does NOT write a success audit", async () => {
    // Closure I — previously the code swallowed Firebase Auth errors,
    // meaning a transient revoke failure was recorded as a successful
    // session exit. The fix surfaces the error and skips the audit.
    const caller = buildAuthUser({
      uid: targetUid,
      roles: ["participant"],
      impersonatedBy: adminUid,
    });
    vi.mocked(auth.revokeRefreshTokens).mockRejectedValueOnce(
      new Error("firebase-auth/network-unavailable"),
    );

    await expect(adminService.endImpersonation(caller, adminUid)).rejects.toThrow(
      /firebase-auth\/network-unavailable/,
    );

    expect(mockAuditAdd).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});

// ─── Bulk status updates (T1.2) ─────────────────────────────────────────────

describe("AdminService.bulkUpdateUserStatus (T1.2)", () => {
  const admin = buildSuperAdmin({ uid: "admin-bulk" });

  beforeEach(() => {
    // Make each user-doc read succeed by default so updateUserStatus
    // can transact against a non-empty doc.
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: "target",
        email: "t@teranga.dev",
        displayName: "Target",
        roles: ["participant"],
        isActive: true,
      }),
    });
  });

  it("delegates per-item to updateUserStatus and reports per-id success", async () => {
    const res = await adminService.bulkUpdateUserStatus(admin, ["u-1", "u-2", "u-3"], false);

    expect(res.succeeded).toEqual(["u-1", "u-2", "u-3"]);
    expect(res.failed).toEqual([]);
    // updateUserStatus emits one user.status_changed event per item;
    // the audit listener would convert each emit into an audit row in
    // production (event bus mocked here, asserting the fan-out count
    // is enough to prove per-item delegation).
    expect(eventBus.emit).toHaveBeenCalledWith("user.status_changed", expect.objectContaining({}));
  });

  it("isolates failures — a bad id does not short-circuit the remaining items", async () => {
    // Fail the second read; the first and third succeed.
    mockUserDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ uid: "u-1", roles: ["participant"], isActive: true }),
      })
      .mockResolvedValueOnce({ exists: false, data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ uid: "u-3", roles: ["participant"], isActive: true }),
      });

    const res = await adminService.bulkUpdateUserStatus(admin, ["u-1", "u-2", "u-3"], true);

    expect(res.succeeded).toEqual(["u-1", "u-3"]);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]).toMatchObject({ id: "u-2" });
  });

  it("refuses non-admin callers", async () => {
    const organizer = buildOrganizerUser("org-1");
    await expect(adminService.bulkUpdateUserStatus(organizer, ["u-1"], false)).rejects.toThrow(
      /platform:manage/i,
    );
  });
});

describe("AdminService.bulkUpdateOrgStatus (T1.2)", () => {
  const admin = buildSuperAdmin({ uid: "admin-bulk-org" });

  beforeEach(() => {
    mockOrgDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ id: "org-x", isActive: true, name: "Org X" }),
    });
  });

  it("delegates per-item and reports per-id success", async () => {
    const res = await adminService.bulkUpdateOrgStatus(admin, ["o-1", "o-2"], false);

    expect(res.succeeded).toEqual(["o-1", "o-2"]);
    expect(res.failed).toEqual([]);
  });

  it("refuses non-admin callers", async () => {
    const organizer = buildOrganizerUser("org-1");
    await expect(adminService.bulkUpdateOrgStatus(organizer, ["o-1"], false)).rejects.toThrow(
      /platform:manage/i,
    );
  });
});
