import { type FastifyRequest, type FastifyReply } from "fastify";
import {
  type Permission,
  type RoleAssignment,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  resolvePermissions,
} from "@teranga/shared-types";
import { type AuthUser } from "./auth.middleware";

/**
 * Permission-based access control middleware.
 *
 * Replaces the rigid `requireRole` approach with granular permission checks.
 * Must be used AFTER `authenticate` middleware — never standalone.
 *
 * Usage:
 *   preHandler: [authenticate, requirePermission("event:create")]
 *   preHandler: [authenticate, requireAllPermissions(["event:update", "event:publish"])]
 *   preHandler: [authenticate, requireAnyPermission(["registration:read_own", "registration:read_all"])]
 */

// ─── Resolve user permissions from JWT claims ────────────────────────────────

function resolveUserPermissions(user: AuthUser): Set<Permission> {
  const assignments: RoleAssignment[] = user.roles.map((role) => ({
    id: `inline-${role}`,
    userId: user.uid,
    role,
    scope: user.organizationId ? ("organization" as const) : ("global" as const),
    organizationId: user.organizationId ?? null,
    eventId: null,
    grantedBy: "system",
    grantedAt: new Date().toISOString(),
    isActive: true,
  }));

  return resolvePermissions(assignments, {
    organizationId: user.organizationId,
  });
}

// ─── Augment Fastify Request to carry resolved permissions ───────────────────

declare module "fastify" {
  interface FastifyRequest {
    permissions?: Set<Permission>;
  }
}

function ensurePermissions(request: FastifyRequest, reply: FastifyReply): Set<Permission> | null {
  if (!request.user) {
    reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Not authenticated" },
    });
    return null;
  }

  // Resolve once per request, cache on request object
  if (!request.permissions) {
    request.permissions = resolveUserPermissions(request.user);
  }

  return request.permissions;
}

// ─── Single Permission ───────────────────────────────────────────────────────

export function requirePermission(permission: Permission) {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const perms = ensurePermissions(request, reply);
    if (!perms) return; // 401 already sent

    if (!hasPermission(perms, permission)) {
      request.log.warn({ uid: request.user!.uid, required: permission }, "Permission check failed");
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: `Missing permission: ${permission}` },
      });
    }
  };
  // Non-enumerable marker so the route-inventory snapshot test can read
  // the guarded permission without parsing closures. Never read by the
  // request pipeline itself — purely an introspection hook.
  Object.defineProperty(handler, "__permission", {
    value: permission,
    enumerable: false,
    writable: false,
  });
  return handler;
}

// ─── All Permissions (AND) ───────────────────────────────────────────────────

export function requireAllPermissions(permissions: Permission[]) {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const perms = ensurePermissions(request, reply);
    if (!perms) return;

    if (!hasAllPermissions(perms, permissions)) {
      request.log.warn(
        { uid: request.user!.uid, required: permissions },
        "Permission check failed (all required)",
      );
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions" },
      });
    }
  };
  Object.defineProperty(handler, "__permissionsAll", {
    value: [...permissions],
    enumerable: false,
    writable: false,
  });
  return handler;
}

// ─── Any Permission (OR) ────────────────────────────────────────────────────

export function requireAnyPermission(permissions: Permission[]) {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const perms = ensurePermissions(request, reply);
    if (!perms) return;

    if (!hasAnyPermission(perms, permissions)) {
      request.log.warn(
        { uid: request.user!.uid, required: permissions },
        "Permission check failed (any required)",
      );
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions" },
      });
    }
  };
  Object.defineProperty(handler, "__permissionsAny", {
    value: [...permissions],
    enumerable: false,
    writable: false,
  });
  return handler;
}

// ─── Organization Scope ─────────────────────────────────────────────────────
// Verifies user belongs to the organization referenced in the request.

export function requireOrganizationScope(orgIdSource: "params" | "body" = "params") {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
    }

    // super_admin bypasses org scope
    if (request.user.roles.includes("super_admin")) return;

    const source = orgIdSource === "params" ? request.params : request.body;
    const orgId = (source as Record<string, string>)?.organizationId;

    if (orgId && request.user.organizationId !== orgId) {
      return reply.status(403).send({
        success: false,
        error: { code: "FORBIDDEN", message: "Access denied to this organization" },
      });
    }
  };
}
