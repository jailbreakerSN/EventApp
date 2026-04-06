import crypto from "node:crypto";
import {
  type CreateInviteDto,
  type OrganizationInvite,
  type Organization,
  PLAN_LIMITS,
} from "@teranga/shared-types";
import { inviteRepository } from "@/repositories/invite.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { userRepository } from "@/repositories/user.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { auth, db, COLLECTIONS } from "@/config/firebase";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  PlanLimitError,
} from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

export class InviteService extends BaseService {
  /**
   * Create an invitation for someone to join the organization.
   */
  async createInvite(
    orgId: string,
    dto: CreateInviteDto,
    user: AuthUser,
  ): Promise<OrganizationInvite> {
    this.requirePermission(user, "organization:manage_members");
    this.requireOrganizationAccess(user, orgId);

    const org = await organizationRepository.findByIdOrThrow(orgId);

    // Check plan limits
    const limits = PLAN_LIMITS[org.plan];
    const currentMembers = org.memberIds?.length ?? 0;
    const pendingInvites = await inviteRepository.findByOrganization(orgId);
    const pendingCount = pendingInvites.filter((i) => i.status === "pending").length;

    if (currentMembers + pendingCount >= limits.maxMembers) {
      throw new PlanLimitError(
        `Maximum ${limits.maxMembers} members (including pending invites) on the ${org.plan} plan`,
      );
    }

    // Check if already a member
    const existingUser = await userRepository.findByEmail(dto.email);
    if (existingUser && org.memberIds?.includes(existingUser.uid)) {
      throw new ConflictError("This user is already a member of the organization");
    }

    // Check if there's already a pending invite
    const existingInvite = await inviteRepository.findByEmailAndOrg(dto.email, orgId);
    if (existingInvite) {
      throw new ConflictError("A pending invitation already exists for this email");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    const invite = await inviteRepository.createWithId(
      `inv-${crypto.randomBytes(8).toString("hex")}`,
      {
        organizationId: orgId,
        organizationName: org.name,
        email: dto.email,
        role: dto.role ?? "member",
        status: "pending",
        invitedBy: user.uid,
        invitedByName: user.email ?? null,
        token,
        expiresAt,
      } as Omit<OrganizationInvite, "id" | "createdAt" | "updatedAt">,
    );

    eventBus.emit("invite.created", {
      inviteId: invite.id,
      organizationId: orgId,
      email: dto.email,
      role: dto.role ?? "member",
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return invite;
  }

  /**
   * List all invitations for an organization.
   */
  async listByOrganization(orgId: string, user: AuthUser): Promise<OrganizationInvite[]> {
    this.requirePermission(user, "organization:read");
    this.requireOrganizationAccess(user, orgId);
    return inviteRepository.findByOrganization(orgId);
  }

  /**
   * Accept an invitation using the token. The current user joins the organization.
   */
  async acceptInvite(token: string, user: AuthUser): Promise<void> {
    const invite = await inviteRepository.findByToken(token);
    if (!invite) throw new NotFoundError("Invite");
    if (invite.status !== "pending") {
      throw new ValidationError(`This invitation has already been ${invite.status}`);
    }
    if (new Date(invite.expiresAt) < new Date()) {
      await inviteRepository.update(invite.id, { status: "expired" } as Partial<OrganizationInvite>);
      throw new ValidationError("This invitation has expired");
    }

    // Verify the accepting user's email matches
    if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ValidationError("This invitation was sent to a different email address");
    }

    // Add user to organization (transactional)
    await db.runTransaction(async (tx) => {
      const orgRef = db.collection(COLLECTIONS.ORGANIZATIONS).doc(invite.organizationId);
      const snap = await tx.get(orgRef);
      if (!snap.exists) throw new NotFoundError("Organization", invite.organizationId);

      const org = { id: snap.id, ...snap.data() } as Organization;
      const members: string[] = org.memberIds ?? [];

      if (members.includes(user.uid)) {
        // Already a member — just mark invite as accepted
        tx.update(db.collection(COLLECTIONS.INVITES).doc(invite.id), {
          status: "accepted",
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      const limits = PLAN_LIMITS[org.plan];
      if (members.length >= limits.maxMembers) {
        throw new PlanLimitError(`Organization has reached the maximum of ${limits.maxMembers} members`);
      }

      tx.update(orgRef, {
        memberIds: [...members, user.uid],
        updatedAt: new Date().toISOString(),
      });
      tx.update(db.collection(COLLECTIONS.INVITES).doc(invite.id), {
        status: "accepted",
        updatedAt: new Date().toISOString(),
      });
    });

    // Set custom claims for the new member
    const existingClaims = (await auth.getUser(user.uid)).customClaims ?? {};
    await auth.setCustomUserClaims(user.uid, {
      ...existingClaims,
      organizationId: invite.organizationId,
    });

    eventBus.emit("invite.accepted", {
      inviteId: invite.id,
      organizationId: invite.organizationId,
      userId: user.uid,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Decline an invitation.
   */
  async declineInvite(token: string, user: AuthUser): Promise<void> {
    const invite = await inviteRepository.findByToken(token);
    if (!invite) throw new NotFoundError("Invite");
    if (invite.status !== "pending") {
      throw new ValidationError(`This invitation has already been ${invite.status}`);
    }

    await inviteRepository.update(invite.id, { status: "declined" } as Partial<OrganizationInvite>);

    eventBus.emit("invite.declined", {
      inviteId: invite.id,
      organizationId: invite.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Revoke a pending invitation (by an org admin).
   */
  async revokeInvite(inviteId: string, user: AuthUser): Promise<void> {
    const invite = await inviteRepository.findByIdOrThrow(inviteId);
    this.requirePermission(user, "organization:manage_members");
    this.requireOrganizationAccess(user, invite.organizationId);

    if (invite.status !== "pending") {
      throw new ValidationError("Can only revoke pending invitations");
    }

    await inviteRepository.update(inviteId, { status: "expired" } as Partial<OrganizationInvite>);
  }
}

export const inviteService = new InviteService();
