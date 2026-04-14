import {
  type Organization,
  type OrgMemberRole,
  type CreateOrganizationDto,
  type UpdateOrganizationDto,
} from "@teranga/shared-types";
import { organizationRepository } from "@/repositories/organization.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { auth, db, COLLECTIONS } from "@/config/firebase";
import { ValidationError, ConflictError, PlanLimitError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

// ─── Service ─────────────────────────────────────────────────────────────────

export class OrganizationService extends BaseService {
  async create(dto: CreateOrganizationDto, user: AuthUser): Promise<Organization> {
    this.requirePermission(user, "organization:create");

    // Check if slug is taken
    const existing = await organizationRepository.findBySlug(dto.slug);
    if (existing) {
      throw new ConflictError(`Organization slug '${dto.slug}' is already taken`);
    }

    // One org per user (unless super_admin)
    if (!user.roles.includes("super_admin")) {
      const existingOwned = await organizationRepository.findByOwner(user.uid);
      if (existingOwned) {
        throw new ConflictError("Vous possédez déjà une organisation");
      }
    }

    const org = await organizationRepository.create({
      ...dto,
      ownerId: user.uid,
      memberIds: [user.uid],
      isVerified: false,
      isActive: true,
    } as Omit<Organization, "id" | "createdAt" | "updatedAt">);

    // Set custom claims so the user has organizer role + organizationId
    await auth.setCustomUserClaims(user.uid, {
      roles: [...new Set([...user.roles, "organizer"])],
      organizationId: org.id,
    });

    eventBus.emit("organization.created", {
      organization: org,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return org;
  }

  async getById(orgId: string, user: AuthUser): Promise<Organization> {
    this.requirePermission(user, "organization:read");
    return organizationRepository.findByIdOrThrow(orgId);
  }

  async getBySlug(slug: string): Promise<Organization> {
    const org = await organizationRepository.findBySlug(slug);
    if (!org) {
      const { NotFoundError } = await import("@/errors/app-error");
      throw new NotFoundError("Organization", slug);
    }
    return org;
  }

  async update(orgId: string, dto: UpdateOrganizationDto, user: AuthUser): Promise<void> {
    this.requirePermission(user, "organization:update");

    const org = await organizationRepository.findByIdOrThrow(orgId);
    this.requireOrganizationAccess(user, org.id);

    await organizationRepository.update(orgId, dto as Partial<Organization>);

    eventBus.emit("organization.updated", {
      organizationId: orgId,
      changes: dto as Record<string, unknown>,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  async addMember(orgId: string, userId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "organization:manage_members");
    this.requireOrganizationAccess(user, orgId);

    await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Organization", orgId);
      }
      const org = { id: snap.id, ...snap.data() } as Organization;
      const members: string[] = org.memberIds ?? [];

      if (members.includes(userId)) return;

      const { allowed, limit } = this.checkPlanLimit(org, "members", members.length);
      if (!allowed) {
        throw new PlanLimitError(
          `Maximum ${limit} members on the ${org.effectivePlanKey ?? org.plan} plan`,
        );
      }

      tx.update(docRef, { memberIds: [...members, userId] });
    });

    eventBus.emit("member.added", {
      organizationId: orgId,
      memberId: userId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    // Set custom claims for the new member
    const existingUser = await auth.getUser(userId);
    const existingClaims = existingUser.customClaims ?? {};
    await auth.setCustomUserClaims(userId, {
      ...existingClaims,
      organizationId: orgId,
    });
  }

  async removeMember(orgId: string, userId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "organization:manage_members");

    const org = await organizationRepository.findByIdOrThrow(orgId);
    this.requireOrganizationAccess(user, org.id);

    // Cannot remove the owner
    if (userId === org.ownerId) {
      throw new ValidationError("Impossible de retirer le propriétaire de l'organisation");
    }

    await organizationRepository.removeMember(orgId, userId);

    eventBus.emit("member.removed", {
      organizationId: orgId,
      memberId: userId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    // Clear organizationId from user's custom claims
    const existingUser = await auth.getUser(userId);
    const existingClaims = existingUser.customClaims ?? {};
    await auth.setCustomUserClaims(userId, {
      ...existingClaims,
      organizationId: null,
    });
  }

  async updateMemberRole(
    orgId: string,
    userId: string,
    role: OrgMemberRole,
    user: AuthUser,
  ): Promise<void> {
    this.requirePermission(user, "organization:manage_members");

    const org = await organizationRepository.findByIdOrThrow(orgId);
    this.requireOrganizationAccess(user, org.id);

    // Cannot change the owner's role
    if (userId === org.ownerId) {
      throw new ValidationError("Impossible de modifier le rôle du propriétaire");
    }

    // Verify user is a member
    if (!org.memberIds?.includes(userId)) {
      throw new ValidationError("Cet utilisateur n'est pas membre de l'organisation");
    }

    // Role "owner" cannot be assigned via this endpoint
    if (role === "owner") {
      throw new ValidationError("Le rôle propriétaire ne peut pas être attribué de cette manière");
    }

    // Update role in custom claims
    const existingUser = await auth.getUser(userId);
    const existingClaims = existingUser.customClaims ?? {};
    await auth.setCustomUserClaims(userId, {
      ...existingClaims,
      orgRole: role,
    });

    eventBus.emit("member.role_updated", {
      organizationId: orgId,
      memberId: userId,
      newRole: role,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }
}

export const organizationService = new OrganizationService();
