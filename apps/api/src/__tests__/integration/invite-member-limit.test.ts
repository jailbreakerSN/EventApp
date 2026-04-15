import { describe, it, expect, beforeEach } from "vitest";
import { inviteService } from "@/services/invite.service";
import { subscriptionService } from "@/services/subscription.service";
import { PlanLimitError, ConflictError } from "@/errors/app-error";
import { buildOrganizerUser, buildSuperAdmin } from "@/__tests__/factories";
import { clearFirestore, seedSystemPlans, createOrgOnPlan } from "./helpers";

/**
 * Regression coverage for organization membership + the freemium
 * `maxMembers` gate. Exercises the real plan limit enforcement path:
 *  - `createInvite` reads `org.effectiveLimits.maxMembers` via
 *    `BaseService.checkPlanLimit` (sum of members + pending invites).
 *  - An admin override lifts the ceiling without requiring a catalog
 *    edit (Phase 5 behaviour).
 *
 * We don't test `acceptInvite` end-to-end because the production path
 * writes Firebase Auth custom claims, and the integration CI job only
 * boots the Firestore emulator (adding the Auth emulator is a cheap
 * future extension when it's actually needed).
 */
describe("Integration: invite + plan member limits", () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedSystemPlans();
  });

  it("free plan blocks a second member invite (maxMembers=1 on the owner)", async () => {
    // Seed org with the owner already occupying the single free-tier slot.
    const ownerUid = "owner-org-free";
    const { id: orgId } = await createOrgOnPlan("free", {
      id: "org-free",
      ownerId: ownerUid,
      memberIds: [ownerUid],
    });
    const ownerWithOrg = buildOrganizerUser(orgId, { uid: ownerUid });

    await expect(
      inviteService.createInvite(
        orgId,
        { email: "someone@test.sn", role: "member" as const },
        ownerWithOrg,
      ),
    ).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("admin-lifted override unblocks the invite without upgrading the tier", async () => {
    const admin = buildSuperAdmin();
    const ownerUid = "owner-org-free-ov";
    const { id: orgId } = await createOrgOnPlan("free", {
      id: "org-free-ov",
      ownerId: ownerUid,
      memberIds: [ownerUid],
    });
    const ownerWithOrg = buildOrganizerUser(orgId, { uid: ownerUid });

    // Before: blocked.
    await expect(
      inviteService.createInvite(
        orgId,
        { email: "before@test.sn", role: "member" as const },
        ownerWithOrg,
      ),
    ).rejects.toBeInstanceOf(PlanLimitError);

    // Admin pins free tier with maxMembers=5.
    await subscriptionService.assignPlan(
      orgId,
      { planId: "free", overrides: { limits: { maxMembers: 5 } } },
      admin,
    );

    // After: invite succeeds and the pending invite is persisted.
    const invite = await inviteService.createInvite(
      orgId,
      { email: "after@test.sn", role: "member" as const },
      ownerWithOrg,
    );
    expect(invite.organizationId).toBe(orgId);
    expect(invite.email).toBe("after@test.sn");
    expect(invite.status).toBe("pending");
  });

  it("pending invites count against the limit (prevents queue-then-accept bypass)", async () => {
    const admin = buildSuperAdmin();
    const ownerUid = "owner-org-starter";
    const { id: orgId } = await createOrgOnPlan("starter", {
      id: "org-starter",
      ownerId: ownerUid,
      memberIds: [ownerUid], // 1 of 3
    });
    const ownerWithOrg = buildOrganizerUser(orgId, { uid: ownerUid });

    // Two pending invites consume the remaining 2 slots.
    await inviteService.createInvite(
      orgId,
      { email: "a@test.sn", role: "member" as const },
      ownerWithOrg,
    );
    await inviteService.createInvite(
      orgId,
      { email: "b@test.sn", role: "member" as const },
      ownerWithOrg,
    );

    // Third invite would push us over the 3-member starter limit.
    await expect(
      inviteService.createInvite(
        orgId,
        { email: "c@test.sn", role: "member" as const },
        ownerWithOrg,
      ),
    ).rejects.toBeInstanceOf(PlanLimitError);

    // Superadmin lifts maxMembers → the third invite goes through.
    await subscriptionService.assignPlan(
      orgId,
      { planId: "starter", overrides: { limits: { maxMembers: 10 } } },
      admin,
    );
    const third = await inviteService.createInvite(
      orgId,
      { email: "c@test.sn", role: "member" as const },
      ownerWithOrg,
    );
    expect(third.email).toBe("c@test.sn");
  });

  it("rejects a second invite for the same email with ConflictError", async () => {
    const ownerUid = "owner-org-dup";
    const { id: orgId } = await createOrgOnPlan("starter", {
      id: "org-dup",
      ownerId: ownerUid,
      memberIds: [ownerUid],
    });
    const ownerWithOrg = buildOrganizerUser(orgId, { uid: ownerUid });

    await inviteService.createInvite(
      orgId,
      { email: "dup@test.sn", role: "member" as const },
      ownerWithOrg,
    );
    await expect(
      inviteService.createInvite(
        orgId,
        { email: "dup@test.sn", role: "member" as const },
        ownerWithOrg,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
