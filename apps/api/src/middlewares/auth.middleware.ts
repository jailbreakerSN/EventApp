import { type FastifyRequest, type FastifyReply } from "fastify";
import { auth } from "@/config/firebase";
import { type UserRole } from "@teranga/shared-types";

// ─── Augment Fastify Request ──────────────────────────────────────────────────

export interface AuthUser {
  uid: string;
  email: string;
  roles: UserRole[];
  organizationId?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

// ─── Authentication Middleware ─────────────────────────────────────────────────

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" },
    });
  }

  const idToken = authHeader.slice(7);

  try {
    const decoded = await auth.verifyIdToken(idToken);

    request.user = {
      uid: decoded.uid,
      email: decoded.email ?? "",
      roles: Array.isArray(decoded.roles) ? (decoded.roles as UserRole[]) : ["participant"],
      organizationId: (decoded.organizationId as string) ?? undefined,
    };
  } catch (_err) {
    request.log.warn({ err: _err }, "Token verification failed");
    return reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
    });
  }
}

// ─── Optional Authentication ──────────────────────────────────────────────────
// Parses token if present but does not reject anonymous requests.

export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return;

  try {
    const decoded = await auth.verifyIdToken(authHeader.slice(7));
    request.user = {
      uid: decoded.uid,
      email: decoded.email ?? "",
      roles: Array.isArray(decoded.roles) ? (decoded.roles as UserRole[]) : ["participant"],
      organizationId: (decoded.organizationId as string) ?? undefined,
    };
  } catch {
    // Token present but invalid — treat as anonymous
  }
}

// ─── Organization Guard ───────────────────────────────────────────────────────
// Verifies user belongs to a specific organization (read from param or body).

export function requireOrganization(orgIdSource: "params" | "body" = "params") {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
    }

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
