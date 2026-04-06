import { describe, it, expect, vi, beforeEach } from "vitest";
import { InviteService } from "../invite.service";
import { buildOrganizerUser, buildAuthUser, buildOrganization, buildInvite } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockInviteRepo = {
  create: vi.fn(),
  createWithId: vi.fn(),
  findByIdOrThrow: vi.fn(),
  findByToken: vi.fn(),
  findByOrganization: vi.fn(),
  findByEmailAndOrg: vi.fn(),
  update: vi.fn(),
};

const mockOrgRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockUserRepo = {
  findByEmail: vi.fn(),
};

vi.mock("@/repositories/invite.repository", () => ({
  inviteRepository: new Proxy({}, {
    get: (_target, prop) => (mockInviteRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: new Proxy({}, {
    get: (_target, prop) => (mockOrgRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/repositories/user.repository", () => ({
  userRepository: new Proxy({}, {
    get: (_target, prop) => (mockUserRepo as Record<string, unknown>)[prop as string],
  }),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

const mockTxUpdate = vi.fn();
const mockTxGet = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    getUser: vi.fn().mockResolvedValue({ customClaims: {} }),
    setCustomUserClaims: vi.fn(),
  },
  db: {
    runTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: mockTxGet, update: mockTxUpdate }),
    ),
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({ id: "mock-doc" }),
    }),
  },
  COLLECTIONS: {
    INVITES: "invites",
    ORGANIZATIONS: "organizations",
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("InviteService", () => {
  const service = new InviteService();
  const orgId = "org-1";
  const org = buildOrganization({ id: orgId, ownerId: "owner-1", memberIds: ["owner-1"], plan: "free" });
  const user = buildOrganizerUser(orgId, { uid: "owner-1" });

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgRepo.findByIdOrThrow.mockResolvedValue(org);
    mockInviteRepo.findByOrganization.mockResolvedValue([]);
    mockInviteRepo.findByEmailAndOrg.mockResolvedValue(null);
    mockUserRepo.findByEmail.mockResolvedValue(null);
  });

  describe("createInvite", () => {
    it("creates an invite for a valid email", async () => {
      const dto = { email: "new@test.com", role: "member" as const };
      const expected = buildInvite({ organizationId: orgId, email: dto.email });
      mockInviteRepo.createWithId.mockResolvedValue(expected);

      const result = await service.createInvite(orgId, dto, user);

      expect(result).toEqual(expected);
      expect(mockInviteRepo.createWithId).toHaveBeenCalledTimes(1);
    });

    it("rejects invite if user is already a member", async () => {
      mockUserRepo.findByEmail.mockResolvedValue({ uid: "owner-1" });
      const dto = { email: "existing@test.com", role: "member" as const };

      await expect(service.createInvite(orgId, dto, user)).rejects.toThrow(
        "already a member",
      );
    });

    it("rejects invite if a pending invite exists", async () => {
      const existing = buildInvite({ email: "dupe@test.com", organizationId: orgId });
      mockInviteRepo.findByEmailAndOrg.mockResolvedValue(existing);
      const dto = { email: "dupe@test.com", role: "member" as const };

      await expect(service.createInvite(orgId, dto, user)).rejects.toThrow(
        "pending invitation already exists",
      );
    });

    it("rejects when plan limit is reached", async () => {
      // Free plan: max 3 members
      const fullOrg = buildOrganization({
        id: orgId,
        ownerId: "owner-1",
        memberIds: ["owner-1", "m2", "m3"],
        plan: "free",
      });
      mockOrgRepo.findByIdOrThrow.mockResolvedValue(fullOrg);

      await expect(
        service.createInvite(orgId, { email: "new@test.com", role: "member" as const }, user),
      ).rejects.toThrow("Maximum");
    });

    it("denies invite for user without org access", async () => {
      const otherUser = buildOrganizerUser("other-org");
      const dto = { email: "new@test.com", role: "member" as const };

      await expect(service.createInvite(orgId, dto, otherUser)).rejects.toThrow(
        "Access denied",
      );
    });
  });

  describe("acceptInvite", () => {
    it("rejects expired invites", async () => {
      const expired = buildInvite({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        status: "pending",
      });
      mockInviteRepo.findByToken.mockResolvedValue(expired);

      await expect(service.acceptInvite(expired.token, user)).rejects.toThrow("expired");
    });

    it("rejects if invite is not pending", async () => {
      const accepted = buildInvite({ status: "accepted" });
      mockInviteRepo.findByToken.mockResolvedValue(accepted);

      await expect(service.acceptInvite(accepted.token, user)).rejects.toThrow(
        "already been accepted",
      );
    });

    it("rejects if token not found", async () => {
      mockInviteRepo.findByToken.mockResolvedValue(null);

      await expect(service.acceptInvite("fake-token", user)).rejects.toThrow("not found");
    });
  });

  describe("revokeInvite", () => {
    it("revokes a pending invite", async () => {
      const invite = buildInvite({
        id: "inv-1",
        organizationId: orgId,
        status: "pending",
      });
      mockInviteRepo.findByIdOrThrow.mockResolvedValue(invite);

      await service.revokeInvite("inv-1", user);

      expect(mockInviteRepo.update).toHaveBeenCalledWith("inv-1", { status: "expired" });
    });

    it("rejects revoking non-pending invites", async () => {
      const invite = buildInvite({
        id: "inv-1",
        organizationId: orgId,
        status: "accepted",
      });
      mockInviteRepo.findByIdOrThrow.mockResolvedValue(invite);

      await expect(service.revokeInvite("inv-1", user)).rejects.toThrow("pending");
    });
  });
});
