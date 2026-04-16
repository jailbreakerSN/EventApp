import { describe, it, expect, vi, beforeEach } from "vitest";
import { InviteService } from "../invite.service";
import {
  buildOrganizerUser,
  buildAuthUser,
  buildOrganization,
  buildInvite,
} from "@/__tests__/factories";

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
  inviteRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockInviteRepo as Record<string, unknown>)[prop as string],
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

const mockTxUpdate = vi.fn();
const mockTxSet = vi.fn();
const mockTxGet = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    getUser: vi.fn().mockResolvedValue({ customClaims: {} }),
    setCustomUserClaims: vi.fn(),
  },
  db: {
    runTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: mockTxGet, update: mockTxUpdate, set: mockTxSet }),
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
  const org = buildOrganization({
    id: orgId,
    ownerId: "owner-1",
    memberIds: ["owner-1"],
    plan: "starter",
  });
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

      await expect(service.createInvite(orgId, dto, user)).rejects.toThrow("déjà membre");
    });

    it("rejects invite if a pending invite exists", async () => {
      const existing = buildInvite({ email: "dupe@test.com", organizationId: orgId });
      mockInviteRepo.findByEmailAndOrg.mockResolvedValue(existing);
      const dto = { email: "dupe@test.com", role: "member" as const };

      await expect(service.createInvite(orgId, dto, user)).rejects.toThrow("invitation en attente");
    });

    it("rejects when plan limit is reached", async () => {
      // Free plan: max 1 member
      const fullOrg = buildOrganization({
        id: orgId,
        ownerId: "owner-1",
        memberIds: ["owner-1"],
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

      await expect(service.createInvite(orgId, dto, otherUser)).rejects.toThrow("Accès refusé");
    });

    it("denies invite for user without manage_members permission", async () => {
      const participant = buildAuthUser({ roles: ["participant"] });
      const dto = { email: "new@test.com", role: "member" as const };

      await expect(service.createInvite(orgId, dto, participant)).rejects.toThrow(
        "Permission manquante",
      );
    });
  });

  describe("listByOrganization", () => {
    it("returns invites for the organization", async () => {
      const invites = [
        buildInvite({ organizationId: orgId }),
        buildInvite({ organizationId: orgId }),
      ];
      mockInviteRepo.findByOrganization.mockResolvedValue(invites);

      const result = await service.listByOrganization(orgId, user);

      expect(result).toHaveLength(2);
      expect(mockInviteRepo.findByOrganization).toHaveBeenCalledWith(orgId);
    });

    it("denies listing for user without org access", async () => {
      const otherUser = buildOrganizerUser("other-org");

      await expect(service.listByOrganization(orgId, otherUser)).rejects.toThrow("Accès refusé");
    });

    it("denies listing for user without read permission", async () => {
      const participant = buildAuthUser({ roles: ["participant"] });

      await expect(service.listByOrganization(orgId, participant)).rejects.toThrow(
        "Permission manquante",
      );
    });
  });

  describe("acceptInvite", () => {
    it("accepts a valid invite and adds user to org", async () => {
      const invite = buildInvite({
        organizationId: orgId,
        email: "test@test.com",
        status: "pending",
      });
      mockInviteRepo.findByToken.mockResolvedValue(invite);

      const acceptUser = buildAuthUser({
        uid: "new-user",
        email: "test@test.com",
        roles: ["participant"],
      });

      // Mock transaction: org has room (starter plan allows 3 members)
      mockTxGet.mockResolvedValue({
        exists: true,
        id: orgId,
        data: () => ({ ...org, plan: "starter", memberIds: ["owner-1"] }),
      });

      await service.acceptInvite(invite.token, acceptUser);

      expect(mockTxUpdate).toHaveBeenCalled();
    });

    it("mirrors organizationId onto the invitee's Firestore user doc inside the tx", async () => {
      // Regression guard for the Class B drift fix: Firestore rules
      // read organizationId from the user doc. Invite accept must commit
      // the mirror in the same tx as the membership change, otherwise
      // the user can't read org resources via the rules despite their
      // claims granting access.
      const invite = buildInvite({
        organizationId: orgId,
        email: "test@test.com",
        status: "pending",
      });
      mockInviteRepo.findByToken.mockResolvedValue(invite);

      const acceptUser = buildAuthUser({
        uid: "new-user",
        email: "test@test.com",
        roles: ["participant"],
      });
      mockTxGet.mockResolvedValue({
        exists: true,
        id: orgId,
        data: () => ({ ...org, plan: "starter", memberIds: ["owner-1"] }),
      });

      await service.acceptInvite(invite.token, acceptUser);

      const userDocSet = mockTxSet.mock.calls.find(
        (call) => (call[1] as Record<string, unknown>).organizationId === orgId,
      );
      expect(userDocSet).toBeDefined();
      // merge:true — survives the case where the invitee's Firestore
      // user doc hasn't been written yet by onUserCreated.
      expect(userDocSet?.[2]).toEqual({ merge: true });
    });

    it("rejects if email does not match", async () => {
      const invite = buildInvite({
        email: "correct@test.com",
        status: "pending",
      });
      mockInviteRepo.findByToken.mockResolvedValue(invite);

      const wrongUser = buildAuthUser({ email: "wrong@test.com" });

      await expect(service.acceptInvite(invite.token, wrongUser)).rejects.toThrow(
        "autre adresse email",
      );
    });

    it("rejects expired invites", async () => {
      const expired = buildInvite({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        status: "pending",
      });
      mockInviteRepo.findByToken.mockResolvedValue(expired);

      await expect(service.acceptInvite(expired.token, user)).rejects.toThrow("expiré");
    });

    it("rejects if invite is not pending", async () => {
      const accepted = buildInvite({ status: "accepted" });
      mockInviteRepo.findByToken.mockResolvedValue(accepted);

      await expect(service.acceptInvite(accepted.token, user)).rejects.toThrow("déjà été traitée");
    });

    it("rejects if token not found", async () => {
      mockInviteRepo.findByToken.mockResolvedValue(null);

      await expect(service.acceptInvite("fake-token", user)).rejects.toThrow("introuvable");
    });
  });

  describe("declineInvite", () => {
    it("declines a valid invite", async () => {
      const invite = buildInvite({
        email: user.email!,
        status: "pending",
      });
      mockInviteRepo.findByToken.mockResolvedValue(invite);

      await service.declineInvite(invite.token, user);

      expect(mockInviteRepo.update).toHaveBeenCalledWith(invite.id, { status: "declined" });
    });

    it("rejects if email does not match", async () => {
      const invite = buildInvite({
        email: "other@test.com",
        status: "pending",
      });
      mockInviteRepo.findByToken.mockResolvedValue(invite);

      await expect(service.declineInvite(invite.token, user)).rejects.toThrow(
        "autre adresse email",
      );
    });

    it("rejects expired invites", async () => {
      const expired = buildInvite({
        email: user.email!,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        status: "pending",
      });
      mockInviteRepo.findByToken.mockResolvedValue(expired);

      await expect(service.declineInvite(expired.token, user)).rejects.toThrow("expiré");
    });

    it("rejects if not pending", async () => {
      const accepted = buildInvite({ status: "accepted" });
      mockInviteRepo.findByToken.mockResolvedValue(accepted);

      await expect(service.declineInvite(accepted.token, user)).rejects.toThrow("déjà été traitée");
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

      await expect(service.revokeInvite("inv-1", user)).rejects.toThrow("en attente");
    });
  });
});
