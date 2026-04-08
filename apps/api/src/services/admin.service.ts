import { BaseService } from "./base.service";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { adminRepository } from "@/repositories/admin.repository";
import { db, auth, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { NotFoundError, ForbiddenError } from "@/errors/app-error";
import type {
  PlatformStats,
  AdminUserQuery,
  AdminOrgQuery,
  AdminEventQuery,
  AdminAuditQuery,
  UserProfile,
  Organization,
  Event,
  AuditLogEntry,
} from "@teranga/shared-types";
import type { PaginatedResult } from "@/repositories/base.repository";

// ─── Admin Service ──────────────────────────────────────────────────────────
// Platform-wide administration. Every method requires platform:manage permission.

class AdminService extends BaseService {
  // ── Platform Stats ────────────────────────────────────────────────────

  async getStats(user: AuthUser): Promise<PlatformStats> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.getPlatformStats();
  }

  // ── User Management ───────────────────────────────────────────────────

  async listUsers(
    user: AuthUser,
    query: AdminUserQuery,
  ): Promise<PaginatedResult<UserProfile>> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.listAllUsers(
      { q: query.q, role: query.role, isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );
  }

  async updateUserRoles(
    user: AuthUser,
    targetUserId: string,
    roles: string[],
  ): Promise<void> {
    this.requirePermission(user, "platform:manage");

    // Prevent self-demotion from super_admin
    if (targetUserId === user.uid && !roles.includes("super_admin")) {
      throw new ForbiddenError("Impossible de retirer votre propre rôle super_admin");
    }

    // Fetch current user doc
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(targetUserId).get();
    if (!userDoc.exists) throw new NotFoundError("User", targetUserId);

    const currentData = userDoc.data()!;
    const oldRoles = (currentData.roles as string[]) ?? ["participant"];

    // Update Firestore user doc
    await db.collection(COLLECTIONS.USERS).doc(targetUserId).update({
      roles,
      updatedAt: new Date().toISOString(),
    });

    // Update Firebase Auth custom claims (critical — JWT is source of truth for middleware)
    await auth.setCustomUserClaims(targetUserId, {
      roles,
      organizationId: currentData.organizationId ?? undefined,
    });

    eventBus.emit("user.role_changed", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      targetUserId,
      oldRoles,
      newRoles: roles,
    });
  }

  async updateUserStatus(
    user: AuthUser,
    targetUserId: string,
    isActive: boolean,
  ): Promise<void> {
    this.requirePermission(user, "platform:manage");

    // Prevent self-suspension
    if (targetUserId === user.uid) {
      throw new ForbiddenError("Impossible de suspendre votre propre compte");
    }

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(targetUserId).get();
    if (!userDoc.exists) throw new NotFoundError("User", targetUserId);

    // Update Firestore
    await db.collection(COLLECTIONS.USERS).doc(targetUserId).update({
      isActive,
      updatedAt: new Date().toISOString(),
    });

    // Disable/enable in Firebase Auth
    await auth.updateUser(targetUserId, { disabled: !isActive });

    eventBus.emit("user.status_changed", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      targetUserId,
      isActive,
    });
  }

  // ── Organization Management ───────────────────────────────────────────

  async listOrganizations(
    user: AuthUser,
    query: AdminOrgQuery,
  ): Promise<PaginatedResult<Organization>> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.listAllOrganizations(
      { q: query.q, plan: query.plan, isVerified: query.isVerified, isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );
  }

  async verifyOrganization(user: AuthUser, orgId: string): Promise<void> {
    this.requirePermission(user, "platform:manage");

    const orgDoc = await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).get();
    if (!orgDoc.exists) throw new NotFoundError("Organization", orgId);

    await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).update({
      isVerified: true,
      updatedAt: new Date().toISOString(),
    });

    eventBus.emit("organization.verified", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      organizationId: orgId,
    });
  }

  async updateOrgStatus(
    user: AuthUser,
    orgId: string,
    isActive: boolean,
  ): Promise<void> {
    this.requirePermission(user, "platform:manage");

    const orgDoc = await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).get();
    if (!orgDoc.exists) throw new NotFoundError("Organization", orgId);

    await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).update({
      isActive,
      updatedAt: new Date().toISOString(),
    });

    eventBus.emit("organization.status_changed", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      organizationId: orgId,
      isActive,
    });
  }

  // ── Event Oversight ───────────────────────────────────────────────────

  async listEvents(
    user: AuthUser,
    query: AdminEventQuery,
  ): Promise<PaginatedResult<Event>> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.listAllEvents(
      { q: query.q, status: query.status, organizationId: query.organizationId },
      { page: query.page, limit: query.limit },
    );
  }

  // ── Audit Logs ────────────────────────────────────────────────────────

  async listAuditLogs(
    user: AuthUser,
    query: AdminAuditQuery,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.listAuditLogs(
      {
        action: query.action,
        actorId: query.actorId,
        resourceType: query.resourceType,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      { page: query.page, limit: query.limit, orderBy: "timestamp", orderDir: "desc" },
    );
  }
}

export const adminService = new AdminService();
