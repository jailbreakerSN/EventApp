import { describe, it, expect, beforeEach } from "vitest";
import { inviteService } from "@/services/invite.service";
import { subscriptionService } from "@/services/subscription.service";
import { PlanLimitError, ValidationError } from "@/errors/app-error";
import { buildAuthUser, buildOrganizerUser, buildSuperAdmin } from "@/__tests__/factories";
import {
  clearFirestore,
  clearAuth,
  seedSystemPlans,
  createOrgOnPlan,
  createAuthUser,
  readOrg,
  readAuthUser,
} from "./helpers";

/**
 * End-to-end coverage for the invite → accept handshake, including the
 * Firebase Auth side-effect that writes `organizationId` into the
 * invitee's custom claims. Mocked unit tests can't exercise this — the
 * real auth.getUser / auth.setCustomUserClaims calls need the Auth
 * emulator.
 *
 * What's at stake: if custom claims aren't written, the invitee signs
 * in with no `organizationId`, so permission resolution treats them as
 * global-scope and every org-scoped permission check fails silently.
 * That's a production-blocking regression.
 */
describe("Integration: invite accept flow (Firestore + Auth emulator)", () => {
  beforeEach(async () => {
    await clearFirestore();
    await clearAuth();
    await seedSystemPlans();
  });

  it("accept adds member transactionally AND writes organizationId into custom claims", async () => {
    // Org with room for one more member (starter: max 3).
    const ownerAuth = await createAuthUser({
      uid: "owner-uid",
      email: "owner@teranga.sn",
      roles: ["organizer"],
      organizationId: "org-starter",
    });
    const { id: orgId } = await createOrgOnPlan("starter", {
      id: "org-starter",
      ownerId: ownerAuth.uid,
      memberIds: [ownerAuth.uid],
    });
    const owner = buildOrganizerUser(orgId, {
      uid: ownerAuth.uid,
      email: ownerAuth.email,
    });

    // 1) Create the invite (regular organizer flow).
    const invite = await inviteService.createInvite(
      orgId,
      { email: "newbie@teranga.sn", role: "member" },
      owner,
    );
    expect(invite.status).toBe("pending");

    // 2) The invitee signs up and lands in Auth with NO organizationId
    //    yet — they only get claims after accepting.
    const inviteeAuth = await createAuthUser({
      uid: "invitee-uid",
      email: "newbie@teranga.sn",
      roles: ["participant"],
    });
    const invitee = buildAuthUser({
      uid: inviteeAuth.uid,
      email: inviteeAuth.email,
      roles: ["participant"],
    });

    // 3) Accept the invite — hits the service transaction.
    await inviteService.acceptInvite(invite.token, invitee);

    // Firestore: invitee appended to memberIds; invite marked accepted.
    const org = await readOrg(orgId);
    expect(org.memberIds).toContain(invitee.uid);
    expect(org.memberIds).toContain(owner.uid);
    expect(org.memberIds?.length).toBe(2);

    // Auth: custom claims now carry organizationId — critical for
    // future permission resolution on the invitee's requests.
    const claims = await readAuthUser(invitee.uid);
    expect(claims.customClaims.organizationId).toBe(orgId);
  });

  it("rejects acceptance when the invitee's email does not match the invite", async () => {
    const ownerAuth = await createAuthUser({
      uid: "owner-uid",
      email: "owner@teranga.sn",
      roles: ["organizer"],
      organizationId: "org-mismatch",
    });
    const { id: orgId } = await createOrgOnPlan("starter", {
      id: "org-mismatch",
      ownerId: ownerAuth.uid,
      memberIds: [ownerAuth.uid],
    });
    const owner = buildOrganizerUser(orgId, { uid: ownerAuth.uid, email: ownerAuth.email });

    const invite = await inviteService.createInvite(
      orgId,
      { email: "intended@teranga.sn", role: "member" },
      owner,
    );

    // Attacker / wrong user tries to accept with their own token.
    const attackerAuth = await createAuthUser({
      uid: "attacker-uid",
      email: "attacker@evil.sn",
      roles: ["participant"],
    });
    const attacker = buildAuthUser({
      uid: attackerAuth.uid,
      email: attackerAuth.email,
      roles: ["participant"],
    });

    await expect(inviteService.acceptInvite(invite.token, attacker)).rejects.toBeInstanceOf(
      ValidationError,
    );

    // Org untouched, attacker's claims unchanged.
    expect((await readOrg(orgId)).memberIds).not.toContain(attacker.uid);
    const attackerClaims = await readAuthUser(attacker.uid);
    expect(attackerClaims.customClaims.organizationId).toBeUndefined();
  });

  it("rejects an expired invite (emulator-friendly — explicit expiry)", async () => {
    const ownerAuth = await createAuthUser({
      uid: "owner-uid",
      email: "owner@teranga.sn",
      roles: ["organizer"],
      organizationId: "org-expire",
    });
    const { id: orgId } = await createOrgOnPlan("starter", {
      id: "org-expire",
      ownerId: ownerAuth.uid,
      memberIds: [ownerAuth.uid],
    });
    const owner = buildOrganizerUser(orgId, { uid: ownerAuth.uid, email: ownerAuth.email });

    const invite = await inviteService.createInvite(
      orgId,
      { email: "late@teranga.sn", role: "member" },
      owner,
    );

    // Manually rewind the invite's expiry past now.
    const { db, COLLECTIONS } = await import("@/config/firebase");
    await db
      .collection(COLLECTIONS.INVITES)
      .doc(invite.id)
      .update({ expiresAt: new Date(Date.now() - 60_000).toISOString() });

    const inviteeAuth = await createAuthUser({
      uid: "late-uid",
      email: "late@teranga.sn",
      roles: ["participant"],
    });
    const invitee = buildAuthUser({
      uid: inviteeAuth.uid,
      email: inviteeAuth.email,
      roles: ["participant"],
    });

    await expect(inviteService.acceptInvite(invite.token, invitee)).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Invite marked "expired" by the service.
    const { readSubscription: _s, ...rest } = await import("./helpers");
    void _s;
    void rest;
    const after = await db.collection(COLLECTIONS.INVITES).doc(invite.id).get();
    expect(after.data()?.status).toBe("expired");
  });

  it("blocks accept when the org has hit maxMembers since the invite was created", async () => {
    // Seed: starter plan (3 members). Admin lowers the effective limit
    // to 2 via an override AFTER the invite was issued — the accept-time
    // check must honour the new ceiling.
    const admin = buildSuperAdmin();
    const ownerAuth = await createAuthUser({
      uid: "owner-uid",
      email: "owner@teranga.sn",
      roles: ["organizer"],
      organizationId: "org-downgraded",
    });
    const { id: orgId } = await createOrgOnPlan("starter", {
      id: "org-downgraded",
      ownerId: ownerAuth.uid,
      memberIds: [ownerAuth.uid, "existing-member"],
    });
    const owner = buildOrganizerUser(orgId, { uid: ownerAuth.uid, email: ownerAuth.email });

    const invite = await inviteService.createInvite(
      orgId,
      { email: "edge@teranga.sn", role: "member" },
      owner,
    );

    // Org now has 2 members + 1 pending. Admin clamps maxMembers to 2.
    // createInvite counted members + pending = 3 but the admin override
    // comes AFTER the invite exists, so acceptInvite is the gatekeeper.
    await subscriptionService.assignPlan(
      orgId,
      { planId: "starter", overrides: { limits: { maxMembers: 2 } } },
      admin,
    );

    const inviteeAuth = await createAuthUser({
      uid: "edge-uid",
      email: "edge@teranga.sn",
      roles: ["participant"],
    });
    const invitee = buildAuthUser({
      uid: inviteeAuth.uid,
      email: inviteeAuth.email,
      roles: ["participant"],
    });

    await expect(inviteService.acceptInvite(invite.token, invitee)).rejects.toBeInstanceOf(
      PlanLimitError,
    );

    // Org untouched; invitee still has no org in claims.
    expect((await readOrg(orgId)).memberIds).not.toContain(invitee.uid);
    expect((await readAuthUser(invitee.uid)).customClaims.organizationId).toBeUndefined();
  });
});
