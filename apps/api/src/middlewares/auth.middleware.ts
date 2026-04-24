import { type FastifyRequest, type FastifyReply } from "fastify";
import { auth } from "@/config/firebase";
import {
  type ApiKeyScope,
  type Permission,
  type UserRole,
  isAdminSystemRole,
} from "@teranga/shared-types";

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
  /**
   * T2.3 — when the caller authenticated with an `terk_*` API key (not
   * a Firebase ID token), `isApiKey` is `true` and `apiKeyId` carries
   * the key's doc id (the `hashPrefix`). Services can use this to
   * branch rate-limiting, emit a different audit marker on mutations,
   * or reject operations that shouldn't be doable by a machine client
   * even when a scope technically allows it.
   */
  isApiKey?: boolean;
  apiKeyId?: string;
  /**
   * When `isApiKey` is true, these are the scopes granted to the key
   * at issuance time. Used by downstream policy helpers to enforce
   * scope-based checks alongside the permission system.
   */
  apiKeyScopes?: ApiKeyScope[];
  /**
   * When `isApiKey` is true, the expanded permission set derived from
   * `apiKeyScopes`. The RBAC middleware reads this directly rather
   * than re-resolving from `roles`.
   */
  apiKeyPermissions?: Permission[];
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

// ─── Authentication Middleware ─────────────────────────────────────────────────

/**
 * Accepts either a Firebase ID token OR a Teranga API key
 * (`terk_<env>_<body>_<checksum>`). The prefix alone steers the
 * branch — we never try to verify a `terk_…` token via Firebase
 * (which would always 401) or vice versa.
 *
 * API-key auth synthesises an `AuthUser` whose `uid` is
 * `apikey:<hashPrefix>` and whose roles are empty. Route-level
 * permission checks MUST look at `apiKeyPermissions` when
 * `isApiKey === true`. The email-verification and organization-access
 * gates already treat API-key callers transparently — see
 * `requireEmailVerified` / `requireOrganization` below.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" },
    });
  }

  const token = authHeader.slice(7);

  if (token.startsWith("terk_")) {
    try {
      return await authenticateApiKey(token, request, reply);
    } catch (err) {
      // Security review P0: any unhandled exception in the API-key
      // branch (Firestore outage, dynamic-import failure) must not
      // propagate as an unhandled rejection — the Cloud Run service
      // would otherwise crash under a hot Firestore incident.
      request.log.warn({ err }, "API key verification failed unexpectedly");
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
      });
    }
  }

  try {
    const decoded = await auth.verifyIdToken(token);

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

/**
 * Branch of `authenticate` that handles `Authorization: Bearer terk_…`.
 * Returns the same 401 shape as the Firebase branch on any failure so
 * leaked prefixes cannot be enumerated via error deltas.
 *
 * We lazy-import `apiKeysService` to avoid a circular dependency
 * (service → repo → config → middleware if it was eager).
 */
async function authenticateApiKey(plaintext: string, request: FastifyRequest, reply: FastifyReply) {
  const { apiKeysService } = await import("@/services/api-keys.service");
  const requestIp = extractClientIp(request);
  const verified = await apiKeysService.verify(plaintext, requestIp);
  if (!verified) {
    return reply.status(401).send({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
    });
  }

  const permissions = apiKeysService.expandScopes(verified.scopes) as Permission[];
  request.user = {
    uid: `apikey:${verified.apiKey.id}`,
    email: "",
    // Empty roles array — API keys do NOT automatically inherit the
    // issuer's roles. The middleware below uses `apiKeyPermissions`
    // directly when `isApiKey === true`.
    roles: [],
    organizationId: verified.apiKey.organizationId,
    // API keys are machine credentials — email-verification doesn't
    // apply. We set it to `true` so `requireEmailVerified` passes and
    // rely on the per-route permission gate as the real boundary.
    emailVerified: true,
    isApiKey: true,
    apiKeyId: verified.apiKey.id,
    apiKeyScopes: verified.scopes,
    apiKeyPermissions: permissions,
  };
}

/**
 * Extract the best-effort client IP from the request. Relies on
 * Fastify's `trustProxy: true` setting in `app.ts` to parse
 * `X-Forwarded-For` correctly — we MUST NOT read the header directly
 * or a caller could forge a value to cycle rate-limit buckets
 * (security-review P1, T2.3). Fastify already rejects forged XFFs
 * when the request didn't come through a trusted proxy.
 */
function extractClientIp(request: FastifyRequest): string | null {
  return request.ip ?? null;
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

    // Every admin system role bypasses the org-scoping check — same
    // exemption as requireEmailVerified above. Sourced from the
    // canonical `isAdminSystemRole` predicate to prevent drift.
    if (request.user.roles.some(isAdminSystemRole)) return;

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
