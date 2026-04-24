import { z } from "zod";

/**
 * T2.3 — Organization-scoped API keys.
 *
 * Industry precedent: Stripe (`sk_live_...`), GitHub (`ghp_...`),
 * Linear (`lin_api_...`). We borrow the exact shape:
 *
 *   `terk_<environment>_<40 chars base62>_<4-char base62 checksum>`
 *
 * Why the format matters:
 *   - `terk_` prefix is greppable on leaked secrets (e.g. GitHub secret
 *     scanning, pre-commit hooks). The issue tool can publish the
 *     prefix to GitHub's secret-scanning partner program later.
 *   - Environment split (`live` / `test`) lets us segregate credentials
 *     for staging vs production without exposing the raw GCP project.
 *   - 40 body chars of base62 ≈ 238 bits of entropy — comfortably
 *     beyond "unguessable".
 *   - 4-char checksum rejects typo'd / corrupted keys before they hit
 *     Firestore. Derived from HMAC(KEY_CHECKSUM_SECRET, body) so only
 *     the server can mint valid keys.
 *
 * Storage discipline:
 *   - Plaintext is returned to the operator EXACTLY ONCE at create time
 *     and then forgotten — we store SHA-256 of the full key, never the
 *     key itself. A leaked database is useless for auth.
 *   - `hashPrefix` (first 10 chars of the plaintext) is the Firestore
 *     doc id — cheap O(1) lookup on incoming requests.
 *   - Plaintext is ALSO the doc id modulo the hash: by using the first
 *     10 chars (the prefix), we keep doc-id stability across rotations
 *     and expose enough of the key in UI ("terk_live_") to be
 *     recognisable without leaking secret material.
 *
 * Scopes for V1 are intentionally read-heavy — see `ApiKeyScopeSchema`.
 * Write scopes (create events, update registrations) come in V2 once
 * we've hardened the audit trail around API-initiated mutations.
 */

// ─── Scopes ──────────────────────────────────────────────────────────────────
//
// A scope on an API key is a narrow, whitelist-only grant. Unlike a
// Permission (which is the atomic unit of ACL inside the app), a Scope
// is a product-surface-level choice the org admin makes when issuing
// the key ("this integration only needs to read registrations"). The
// middleware expands each scope into the matching permission set at
// auth time — the mapping lives in `SCOPE_TO_PERMISSIONS` below.
//
// Why these four for V1:
//   - `event:read`              → read org's events
//   - `registration:read_all`   → export participant lists for a CRM sync
//   - `badge:generate`          → trigger badge PDF generation at scale
//   - `checkin:scan`            → integrate a custom scanner / turnstile
//
// What is explicitly NOT in V1 (and why):
//   - `event:create` / `event:update` — mutating events from an API
//     key needs richer audit context (who's the "organizer" on the
//     event? how does the rate limit interact?) — punt to V2.
//   - `payment:*` — money-touching is super-admin / organizer-only.
//   - `organization:manage_members` — key itself is org-scoped; adding
//     members via a key creates a confusing chain of trust.

export const ApiKeyScopeSchema = z.enum([
  "event:read",
  "registration:read_all",
  "badge:generate",
  "checkin:scan",
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

/**
 * Stable mapping of scopes → resolved permissions at request time.
 * Kept in shared-types so the web-backoffice can preview what each
 * scope unlocks without re-implementing the table.
 */
export const SCOPE_TO_PERMISSIONS: Record<ApiKeyScope, readonly string[]> = {
  "event:read": ["event:read"],
  "registration:read_all": ["registration:read_all", "registration:read_own"],
  "badge:generate": ["badge:generate", "badge:bulk_generate"],
  "checkin:scan": ["checkin:scan", "checkin:manual", "checkin:view_log", "checkin:sync_offline"],
} as const;

// ─── Environment ─────────────────────────────────────────────────────────────

export const ApiKeyEnvironmentSchema = z.enum(["live", "test"]);
export type ApiKeyEnvironment = z.infer<typeof ApiKeyEnvironmentSchema>;

// ─── Stored row ──────────────────────────────────────────────────────────────

export const ApiKeyStatusSchema = z.enum(["active", "revoked"]);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

export const ApiKeySchema = z.object({
  /** Firestore doc id — equal to `hashPrefix`. Safe to expose. */
  id: z.string().min(1),
  organizationId: z.string().min(1),
  /**
   * Human label supplied by the issuer ("Scanner iPad #3",
   * "CRM sync — HubSpot"). Surfaced in the list UI; never used for
   * auth decisions.
   */
  name: z.string().min(1).max(100),
  /**
   * First 10 chars of the plaintext key (`terk_live_<4 first body chars>`).
   * Safe to show in UI as a fingerprint. Doc id = this value so that
   * auth checks can resolve in one doc read.
   */
  hashPrefix: z.string().min(10).max(10),
  /**
   * SHA-256 hex of the full plaintext key. What we compare against on
   * each request with `crypto.timingSafeEqual`. A database leak
   * compromises NO credentials.
   */
  keyHash: z.string().length(64),
  scopes: z.array(ApiKeyScopeSchema).min(1).max(16),
  environment: ApiKeyEnvironmentSchema,
  status: ApiKeyStatusSchema,
  /** Uid of the user who issued the key. */
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /**
   * Fire-and-forget bookkeeping: updated opportunistically on each
   * successful auth. Not transactional — a rare missed write is fine.
   * Null until the key has been used once.
   */
  lastUsedAt: z.string().datetime().nullable(),
  /** Best-effort IP from X-Forwarded-For at last use. Null for never-used. */
  lastUsedIp: z.string().nullable(),
  /**
   * Null while `status === "active"`; set atomically with the
   * `status: revoked` transition.
   */
  revokedAt: z.string().datetime().nullable(),
  revokedBy: z.string().nullable(),
  /**
   * Short operator-supplied reason ("rotated", "employee departure",
   * "leaked in public repo"). Never empty when `revokedAt != null`.
   * Defaults to "manual" if the endpoint was called without a reason.
   */
  revocationReason: z.string().nullable(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

// ─── API DTOs ────────────────────────────────────────────────────────────────

export const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(ApiKeyScopeSchema).min(1).max(16),
  environment: ApiKeyEnvironmentSchema.default("live"),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

/**
 * Response shape of `POST /v1/organizations/:orgId/api-keys` — note the
 * `plaintext` field, present EXACTLY ONCE. Subsequent GETs omit it
 * forever; the operator must copy it now or re-issue.
 */
export const CreateApiKeyResponseSchema = z.object({
  apiKey: ApiKeySchema,
  plaintext: z.string(),
});
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponseSchema>;

export const RevokeApiKeyRequestSchema = z.object({
  reason: z.string().min(1).max(200).optional(),
});
export type RevokeApiKeyRequest = z.infer<typeof RevokeApiKeyRequestSchema>;

export const RotateApiKeyRequestSchema = z.object({
  /** Optional new label. Defaults to appending " (rotated N)" to the old name. */
  name: z.string().min(1).max(100).optional(),
  reason: z.string().min(1).max(200).optional(),
});
export type RotateApiKeyRequest = z.infer<typeof RotateApiKeyRequestSchema>;

/**
 * Response shape of the rotate endpoint — carries the NEW key's
 * plaintext + row AND a handle to the revoked old row for audit UI.
 */
export const RotateApiKeyResponseSchema = z.object({
  newApiKey: ApiKeySchema,
  plaintext: z.string(),
  revokedApiKeyId: z.string(),
});
export type RotateApiKeyResponse = z.infer<typeof RotateApiKeyResponseSchema>;
