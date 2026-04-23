import { type FastifyRequest, type FastifyReply } from "fastify";
import { auth } from "@/config/firebase";
import { type UserRole, isAdminSystemRole } from "@teranga/shared-types";

// ─── Augment Fastify Request ──────────────────────────────────────────────────

export interface AuthUser {
  uid: string;
  email: string;
  roles: UserRole[];
  organizationId?: string;
  /**
   * Whether the user's email has been verified. Sourced from the
   * decoded Firebase ID token's `email_verified` claim.
   * Used by `requireEmailVerified` to gate mutating routes and by the
   * backoffice dashboard layout's UX-level gate (CLAUDE.md §H6).
   */
  emailVerified: boolean;
  /**
   * When set, this session is an impersonation session: `impersonatedBy`
   * is the UID of the super-admin who minted the custom token. Sourced
   * from the signed `impersonatedBy` custom claim baked by
   * `AdminService.startImpersonation`. Consumed by `endImpersonation`
   * to verify the caller owns the session before revoking it, and by
   * the backoffice `ImpersonationBanner` to surface the actor's identity.
   */
  impersonatedBy?: string;
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
      emailVerified: decoded.email_verified === true,
      impersonatedBy:
        typeof decoded.impersonatedBy === "string" ? decoded.impersonatedBy : undefined,
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
      emailVerified: decoded.email_verified === true,
      impersonatedBy:
        typeof decoded.impersonatedBy === "string" ? decoded.impersonatedBy : undefined,
    };
  } catch {
    // Token present but invalid — treat as anonymous
  }
}

// ─── Email-Verification Guard ─────────────────────────────────────────────────
// Rejects mutating requests from users whose Firebase email is not verified.
// Must run AFTER `authenticate` so `request.user` is populated.
//
// Exemptions:
//   - Every admin role in `ADMIN_SYSTEM_ROLES` (super_admin + the 5
//     `platform:*` subroles). Platform operators must never be locked
//     out by a verification race (CLAUDE.md §H6). The exemption set is
//     imported from `@teranga/shared-types` so API + web-backoffice
//     cannot drift — see PR #163 review which caught the previous
//     `super_admin`-only check as a correctness gap: the web client
//     was already using the full set, so a `platform:support` user
//     would pass the client gate but fail this API gate.
//
// Behaviour:
//   - If `request.user` is missing → 401 (authenticate must run first).
//   - If user holds any admin system role → pass.
//   - If user.emailVerified → pass.
//   - Otherwise → 403 EMAIL_NOT_VERIFIED.
//
// The matching UX-level gate in apps/web-backoffice/src/app/(dashboard)/
// layout.tsx redirects unverified users past the grace period to
// /verify-email. This API guard is the security boundary — do not rely
// on the client gate alone.

export async function requireEmailVerified(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Not authenticated" },
    });
  }

  // Every admin system role bypasses the gate (operational necessity).
  if (request.user.roles.some(isAdminSystemRole)) return;

  if (!request.user.emailVerified) {
    return reply.status(403).send({
      success: false,
      error: {
        code: "EMAIL_NOT_VERIFIED",
        message: "Email verification required. Check your inbox for the verification link.",
      },
    });
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
