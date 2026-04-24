import { z } from "zod";

/**
 * Cross-origin impersonation — OAuth-style authorization-code flow.
 *
 * The old flow returned a Firebase custom token directly from the admin
 * impersonate endpoint, signed-in on the backoffice origin, then tried to
 * redirect to the participant app. Firebase Auth sessions are scoped per
 * origin (IndexedDB), so the participant app booted unauthenticated and
 * the admin had to fight it manually. A fragment-based handoff (#token=)
 * would leak the custom token into browser history, extensions, analytics
 * breadcrumbs, and any JS executing on the landing route — unacceptable
 * for an impersonation credential.
 *
 * The industry pattern (AWS federation, Auth0 / Okta impersonation,
 * Stripe "view as") is an authorization-code exchange:
 *   1. Admin clicks Impersonate → API mints an opaque, single-use,
 *      short-lived code (32 random bytes, ≤ 60 s TTL) bound to the
 *      target user + target origin + admin IP/UA.
 *   2. Backoffice opens the target app's `/impersonation/accept?code=…`
 *      route in a NEW tab (`window.open` with `noopener,noreferrer`).
 *   3. Target app calls `POST /v1/impersonation/exchange` with the code.
 *      The API validates (unexpired, unconsumed, Origin matches), marks
 *      consumed in a Firestore transaction, reads the target profile
 *      fresh, and mints the Firebase custom token server-side.
 *   4. Target app calls `signInWithCustomToken` with the response,
 *      strips the code from the URL (history.replaceState), writes the
 *      impersonation-banner breadcrumb, and redirects to the home route.
 *
 * Security properties:
 *   - The Firebase custom token never appears in a URL or browser
 *     history — only in the exchange response body (HTTPS).
 *   - The code is opaque and single-use; brute force is bounded by
 *     the exchange endpoint's rate limit (30 req/min/IP) and the 60 s
 *     TTL, against a 256-bit key space. Not a useful attack surface.
 *   - Origin binding stops a leaked code from being consumed on a
 *     different app even if an attacker captures it.
 *   - Both the issue and the exchange write separate audit-log rows,
 *     giving SOC 2-grade traceability.
 *   - The admin's own session is untouched because the exchange
 *     happens in a new tab. No cross-origin session mutation.
 */

// ─── Issue (backoffice calls /v1/admin/users/:uid/impersonate) ────────────────

export const ImpersonationIssueResponseSchema = z.object({
  /**
   * Opaque URL-safe random string (32 bytes, base64url encoded = 43 chars).
   * Lives in our DB only as a SHA-256 hash. Single-use, ≤ 60 s TTL.
   */
  code: z.string().min(32).max(64),
  /**
   * Absolute URL the admin's browser should open (new tab). Guaranteed
   * to carry the same `code` in its query string; the target app's
   * accept route consumes it via POST, never GET.
   */
  acceptUrl: z.string().url(),
  /**
   * Canonical origin (scheme + host + port) the code is bound to. The
   * API refuses the exchange if the browser's `Origin` header on the
   * exchange request doesn't match this value. Stored server-side at
   * issue time; echoed here so the client can double-check / surface
   * a deterministic URL in admin tooling.
   */
  targetOrigin: z.string().url(),
  /**
   * TTL deadline as ISO timestamp. Clients SHOULD warn the admin if
   * they don't click through within a few seconds — the accept URL
   * becomes a 410 after this instant.
   */
  expiresAt: z.string().datetime(),
  targetUid: z.string(),
  targetDisplayName: z.string().nullable(),
  targetEmail: z.string().nullable(),
  /**
   * Informational echo of the target's roles. The custom token minted
   * at exchange time uses claims derived from a FRESH profile read,
   * not these values — so an admin editing roles between issue and
   * exchange gets the new claims, not a stale snapshot.
   */
  targetRoles: z.array(z.string()),
});
export type ImpersonationIssueResponse = z.infer<typeof ImpersonationIssueResponseSchema>;

// ─── Exchange (target app calls /v1/impersonation/exchange) ────────────────────

export const ImpersonationExchangeRequestSchema = z.object({
  code: z.string().min(32).max(64),
});
export type ImpersonationExchangeRequest = z.infer<typeof ImpersonationExchangeRequestSchema>;

export const ImpersonationExchangeResponseSchema = z.object({
  /**
   * Firebase custom token — signed by `auth.createCustomToken` with the
   * target's fresh claims (roles, organizationId, orgRole) plus the
   * `impersonatedBy` / `impersonationExpiresAt` stamp. The target app
   * exchanges this with `signInWithCustomToken` on ITS OWN Firebase
   * Auth instance to land the session.
   */
  customToken: z.string(),
  /**
   * The admin who issued the code. Echoed so the target app's banner
   * can display "Impersonation par Alice Dupont" without a second RTT.
   */
  actorUid: z.string(),
  actorDisplayName: z.string().nullable(),
  targetUid: z.string(),
  targetDisplayName: z.string().nullable(),
  targetEmail: z.string().nullable(),
  /** Session deadline — same 30-minute cap as the legacy flow. */
  expiresAt: z.string().datetime(),
});
export type ImpersonationExchangeResponse = z.infer<typeof ImpersonationExchangeResponseSchema>;
