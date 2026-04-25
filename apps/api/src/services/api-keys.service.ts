import crypto from "node:crypto";
import { type FieldValue } from "firebase-admin/firestore";
import {
  type ApiKey,
  type ApiKeyEnvironment,
  type ApiKeyScope,
  type CreateApiKeyRequest,
  type Organization,
  type Permission,
  ERROR_CODES,
  SCOPE_TO_PERMISSIONS,
} from "@teranga/shared-types";
import { BaseService } from "./base.service";
import { apiKeysRepository } from "@/repositories/api-keys.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { db, COLLECTIONS } from "@/config/firebase";
import { config } from "@/config";
import { AppError, NotFoundError, PlanLimitError } from "@/errors/app-error";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import { type AuthUser } from "@/middlewares/auth.middleware";

/**
 * T2.3 — Organization-scoped API keys.
 *
 * Lifecycle:
 *   issue  → mints plaintext, stores SHA-256. Plaintext returned ONCE.
 *   verify → used by the auth middleware. Constant-time equality.
 *   list   → CRUD list for the issuance UI.
 *   revoke → flips status; does NOT delete (audit trail).
 *   rotate → atomic "revoke + issue". Use case: leak response.
 *
 * Cryptographic notes:
 *   - Keys use 40 bytes of cryptographically random base62 (0-9 A-Z a-z),
 *     which gives log2(62^40) ≈ 238 bits of entropy.
 *   - The 4-char checksum is `base62(HMAC-SHA256(CHECKSUM_SECRET, body).slice(0, 4))`.
 *     It rejects typo'd keys BEFORE a Firestore read; compromising it
 *     does NOT compromise authentication (the hash does).
 *   - We compare the SHA-256 hash of the plaintext to the stored hash
 *     with `crypto.timingSafeEqual`. Constant-time comparison mitigates
 *     timing-based side-channel enumeration.
 *   - Plaintext keys are emitted ONCE at creation and never persisted.
 *     We cannot "email the key to the admin" — it exists only in the
 *     HTTP response.
 */

// Base62 alphabet — URL-safe, no padding, cross-library canonical.
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Security-review P1 — hard ceiling on active (non-revoked) keys per
 * organization. Keeps the `apiKeys` collection bounded and forces
 * hygiene ("revoke an unused key before issuing a new one"). Raising
 * this is a product decision, not a silent code change — bump here
 * AND document in CLAUDE.md § Freemium plan table.
 */
const MAX_ACTIVE_KEYS_PER_ORG = 20;

/**
 * Senior-review remediation — throttle the `api_key.verified` emit
 * to at most one per (key, ipHash, uaHash) per hour. Prevents
 * auditLogs from flooding under a normal request rate while still
 * surfacing the "new IP / UA" signal SOC alerting cares about.
 * Per-pod in-memory state; see the comment in `verify()` for why
 * distributed throttling is unnecessary.
 */
const VERIFY_THROTTLE_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_THROTTLE_MAX_ENTRIES = 10_000;
const verifyThrottle = new Map<string, number>();

function trimThrottle(nowMs: number): void {
  // Drop entries older than 2× the window — they'll never suppress
  // another emit (the next attempt is past the window anyway).
  const cutoff = nowMs - 2 * VERIFY_THROTTLE_MS;
  for (const [key, ts] of verifyThrottle) {
    if (ts < cutoff) verifyThrottle.delete(key);
  }
}

/** SHA-256 of the input, truncated to 16 hex chars — linkable, not PII. */
function hashShort(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function randomBase62(length: number): string {
  const out = new Array<string>(length);
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    // Rejection of bias from (256 % 62) is negligible for a 40-char body
    // (~0.06% skew per char) — acceptable for this use-case. If a future
    // auditor objects, swap for crypto.randomInt-based rejection sampling.
    out[i] = BASE62[bytes[i] % 62];
  }
  return out.join("");
}

function computeChecksum(body: string): string {
  const digest = crypto.createHmac("sha256", config.API_KEY_CHECKSUM_SECRET).update(body).digest();
  // Take 4 bytes, map each to a base62 char. 62^4 ≈ 14.7M outcomes,
  // enough to catch single-char typos with ~1 in 14M false-positive rate.
  const chars = new Array<string>(4);
  for (let i = 0; i < 4; i++) chars[i] = BASE62[digest[i] % 62];
  return chars.join("");
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Format: `terk_<env>_<40 chars body>_<4-char checksum>`.
 * Returns { plaintext, hashPrefix, keyHash } so the service can persist
 * the non-secret parts and hand the plaintext to the caller.
 */
function generateKeyMaterial(env: ApiKeyEnvironment): {
  plaintext: string;
  hashPrefix: string;
  keyHash: string;
} {
  const body = randomBase62(40);
  const checksum = computeChecksum(body);
  const plaintext = `terk_${env}_${body}_${checksum}`;
  // hashPrefix = first 10 chars of the plaintext = `terk_live_` or
  // `terk_test_`. Same prefix for every live key — that's fine: the
  // prefix is ONLY the doc id. The actual uniqueness lives in the
  // body + hash. We use the first 10 chars of the body for the doc id
  // instead:
  //
  //   terk_live_abcdef...  →  hashPrefix = "terk_live_"
  //
  // Wait — every live key would then collide on doc id. Switching to
  // first 10 chars of the body (the entropy-bearing section).
  const bodyPrefix10 = body.slice(0, 10);
  return {
    plaintext,
    hashPrefix: bodyPrefix10,
    keyHash: sha256Hex(plaintext),
  };
}

/**
 * Parse an incoming bearer token into its canonical components, running
 * format + checksum validation. Returns `null` on any format failure;
 * never throws. Constant-time properties irrelevant here — a malformed
 * prefix is public knowledge.
 */
export function parseApiKey(
  raw: string,
): { env: ApiKeyEnvironment; body: string; checksum: string; hashPrefix: string } | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("terk_")) return null;
  const parts = raw.split("_");
  // Expected shape: ["terk", env, body, checksum]
  if (parts.length !== 4) return null;
  const [, env, body, checksum] = parts;
  if (env !== "live" && env !== "test") return null;
  if (body.length !== 40) return null;
  if (checksum.length !== 4) return null;
  // Checksum match — rejects typos BEFORE hitting Firestore.
  const expected = computeChecksum(body);
  if (!crypto.timingSafeEqual(Buffer.from(checksum, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }
  return { env: env as ApiKeyEnvironment, body, checksum, hashPrefix: body.slice(0, 10) };
}

export class ApiKeysService extends BaseService {
  /**
   * Issue a new API key for the caller's organization.
   *
   * Flow:
   *  1. Plan gate: `apiAccess` must be enabled (enterprise-tier).
   *  2. Permission check: caller needs `organization:manage_billing`
   *     — we reuse the billing permission because API keys ARE a
   *     billing-adjacent concern (enterprise-only, revenue-protecting).
   *  3. Generate material + persist atomically via `createWithId`.
   *     We write the full row (including plaintext-derived fields) in
   *     ONE `set()` so a crash mid-flight can never leave a row that's
   *     readable but unverifiable.
   *  4. Emit `api_key.created` → audit listener.
   *
   * Returns the persisted row PLUS the plaintext. Route handler must
   * return the plaintext to the caller and drop it immediately.
   */
  async issue(
    user: AuthUser,
    organizationId: string,
    request: CreateApiKeyRequest,
  ): Promise<{ apiKey: ApiKey; plaintext: string }> {
    this.requireOrganizationAccess(user, organizationId);
    this.requirePermission(user, "organization:manage_billing");

    const org = await organizationRepository.findByIdOrThrow(organizationId);
    this.requireApiAccess(org);

    // Security-review P1 (T2.3) — per-org ceiling on active keys.
    // Without this an org could mint keys in a tight loop, evading
    // revocation audits and filling the `apiKeys` collection with
    // hashes whose plaintexts nobody holds. 20 is generous enough
    // to cover: CRM integration + scanner fleet + CI test keys +
    // contingency spares; if an operator legitimately needs more
    // they must revoke stale ones first, which is the right
    // pressure toward key hygiene.
    const active = await apiKeysRepository.countActive(organizationId);
    if (active >= MAX_ACTIVE_KEYS_PER_ORG) {
      throw new PlanLimitError(
        `Plafond de ${MAX_ACTIVE_KEYS_PER_ORG} clés actives atteint. Révoquez les clés inutilisées avant d'en émettre une nouvelle.`,
        {
          feature: "apiAccess",
          plan: org.effectivePlanKey ?? org.plan,
          current: active,
          max: MAX_ACTIVE_KEYS_PER_ORG,
        },
      );
    }

    const material = generateKeyMaterial(request.environment);
    const now = new Date().toISOString();
    const doc: ApiKey = {
      id: material.hashPrefix,
      organizationId,
      name: request.name,
      hashPrefix: material.hashPrefix,
      keyHash: material.keyHash,
      scopes: request.scopes,
      environment: request.environment,
      status: "active",
      createdBy: user.uid,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      lastUsedIp: null,
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
    };

    // Write via createWithId — fails if the prefix collides (1 in 62^10
    // ≈ 1 in 8e17, but we handle the error gracefully anyway).
    //
    // SENIOR-REVIEW FIX — the `plaintext` we hand back MUST match the
    // `keyHash` we persist. The previous implementation mutated the
    // outer `material` object on retry, which was correct but fragile
    // (a future refactor renaming `material` to `const` would silently
    // brick the key). We now track the "winning" material in a mutable
    // local and swap it atomically with the doc fields on each retry.
    let persisted = material;
    const MAX_PREFIX_COLLISION_RETRIES = 2;
    let lastErr: unknown = undefined;
    for (let attempt = 0; attempt <= MAX_PREFIX_COLLISION_RETRIES; attempt++) {
      try {
        await db.collection(COLLECTIONS.API_KEYS).doc(doc.id).create(doc);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt === MAX_PREFIX_COLLISION_RETRIES) break;
        // Mint fresh material; keep `doc` and `persisted` in lockstep.
        const fresh = generateKeyMaterial(request.environment);
        doc.id = fresh.hashPrefix;
        doc.hashPrefix = fresh.hashPrefix;
        doc.keyHash = fresh.keyHash;
        persisted = fresh;
      }
    }
    if (lastErr !== undefined) {
      throw new AppError({
        message: "Impossible de générer une clé unique — réessayez.",
        code: ERROR_CODES.INTERNAL_ERROR,
        statusCode: 500,
        cause: lastErr instanceof Error ? lastErr : undefined,
      });
    }

    const ctx = getRequestContext();
    eventBus.emit("api_key.created", {
      actorId: user.uid,
      requestId: ctx?.requestId ?? "unknown",
      timestamp: now,
      apiKeyId: doc.id,
      organizationId,
      scopes: doc.scopes,
      environment: doc.environment,
      name: doc.name,
    });

    return { apiKey: doc, plaintext: persisted.plaintext };
  }

  async list(
    user: AuthUser,
    organizationId: string,
    pagination: { page: number; limit: number },
  ): Promise<{
    data: ApiKey[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    this.requireOrganizationAccess(user, organizationId);
    this.requirePermission(user, "organization:read");
    const result = await apiKeysRepository.listByOrganization(organizationId, pagination);
    // Strip `keyHash` from the wire — it's an internal detail and
    // there's no legitimate reason for the client to see it.
    return {
      data: result.data.map((k) => ({ ...k, keyHash: "" })),
      meta: result.meta,
    };
  }

  async get(user: AuthUser, organizationId: string, apiKeyId: string): Promise<ApiKey> {
    this.requireOrganizationAccess(user, organizationId);
    this.requirePermission(user, "organization:read");
    const row = await apiKeysRepository.findById(apiKeyId);
    if (!row || row.organizationId !== organizationId) {
      throw new NotFoundError("apiKey", apiKeyId);
    }
    return { ...row, keyHash: "" };
  }

  /**
   * T2.3 closure — request-volume analytics for one API key.
   *
   * Reconstructs a daily-bucket histogram from the `api_key.verified`
   * audit rows for this key over the last 30 days. The `verified`
   * event itself is per-pod throttled (see `VERIFY_THROTTLE_MS`) so
   * the count under-reports raw verifications by a constant factor
   * — but the SHAPE (which days had traffic, which were quiet) is
   * preserved, which is what an operator chasing an anomaly cares
   * about. The throttle factor is documented in the response so the
   * UI can warn.
   *
   * Permission: `organization:read` + `requireOrganizationAccess`
   * (super-admin gets cross-org via the admin bypass).
   */
  async getUsageAnalytics(
    user: AuthUser,
    organizationId: string,
    apiKeyId: string,
  ): Promise<{
    apiKeyId: string;
    daily: Array<{ day: string; count: number }>;
    totalLast30d: number;
    /**
     * `api_key.verified` is throttled per-pod to once per
     * (key, ipHash, uaHash) per hour. Surface this so the UI can
     * label the count as a lower bound rather than an exact total.
     */
    throttleWindowMs: number;
  }> {
    this.requireOrganizationAccess(user, organizationId);
    this.requirePermission(user, "organization:read");

    // Existence check + cross-org guard — reuses `get` to keep the
    // 404 shape identical.
    await this.get(user, organizationId, apiKeyId);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const snap = await db
      .collection(COLLECTIONS.AUDIT_LOGS)
      .where("action", "==", "api_key.verified")
      .where("resourceId", "==", apiKeyId)
      .where("timestamp", ">=", thirtyDaysAgo)
      .select("timestamp")
      .limit(2000)
      .get();

    // Bucket by Africa/Dakar day (UTC offset 0 ─ Senegal observes
    // no DST). Slice the ISO string at index 10 ("YYYY-MM-DD").
    const counts = new Map<string, number>();
    for (const doc of snap.docs) {
      const row = doc.data() as { timestamp?: string };
      if (!row.timestamp) continue;
      const day = row.timestamp.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }

    // Emit one row per day in the lookback window so the sparkline
    // axis stays evenly spaced even on a quiet key.
    const daily: Array<{ day: string; count: number }> = [];
    let total = 0;
    const now = Date.now();
    for (let offset = 29; offset >= 0; offset -= 1) {
      const dayDate = new Date(now - offset * 24 * 60 * 60 * 1000);
      const day = dayDate.toISOString().slice(0, 10);
      const count = counts.get(day) ?? 0;
      daily.push({ day, count });
      total += count;
    }

    return {
      apiKeyId,
      daily,
      totalLast30d: total,
      throttleWindowMs: 60 * 60 * 1000,
    };
  }

  /**
   * Revoke a key. Transactional so the state transition (active →
   * revoked) can't race against a concurrent rotate. The row is
   * preserved for audit — we never hard-delete.
   */
  async revoke(
    user: AuthUser,
    organizationId: string,
    apiKeyId: string,
    reason: string | undefined,
  ): Promise<ApiKey> {
    this.requireOrganizationAccess(user, organizationId);
    this.requirePermission(user, "organization:manage_billing");

    const now = new Date().toISOString();
    const docRef = db.collection(COLLECTIONS.API_KEYS).doc(apiKeyId);

    const updated = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) throw new NotFoundError("apiKey", apiKeyId);
      const current = snap.data() as ApiKey;
      if (current.organizationId !== organizationId) {
        throw new NotFoundError("apiKey", apiKeyId);
      }
      // Idempotent — double-revoke is a harmless UX click.
      if (current.status === "revoked") return current;
      const patch = {
        status: "revoked" as const,
        revokedAt: now,
        revokedBy: user.uid,
        revocationReason: reason ?? "manual",
        updatedAt: now,
      };
      tx.update(docRef, patch);
      return { ...current, ...patch };
    });

    // Audit emit AFTER the commit — listener is fire-and-forget.
    const ctx = getRequestContext();
    eventBus.emit("api_key.revoked", {
      actorId: user.uid,
      requestId: ctx?.requestId ?? "unknown",
      timestamp: now,
      apiKeyId: updated.id,
      organizationId,
      reason: reason ?? "manual",
    });

    return { ...updated, keyHash: "" };
  }

  /**
   * Atomic rotate: revoke the old key + issue a new one in the same
   * transaction. Critical for leak response — an org's CI sees the
   * new plaintext in one HTTP response and the old key stops working
   * before the response reaches them.
   */
  async rotate(
    user: AuthUser,
    organizationId: string,
    oldApiKeyId: string,
    options: { name?: string; reason?: string },
  ): Promise<{ newApiKey: ApiKey; plaintext: string; revokedApiKeyId: string }> {
    this.requireOrganizationAccess(user, organizationId);
    this.requirePermission(user, "organization:manage_billing");

    const oldRef = db.collection(COLLECTIONS.API_KEYS).doc(oldApiKeyId);
    const now = new Date().toISOString();

    // Plan-gate check needs the org doc; happens outside the tx but
    // reads a field that's never mutated by the rotate path itself.
    // Safe even if the org is concurrently updated elsewhere.
    const org = await organizationRepository.findByIdOrThrow(organizationId);
    this.requireApiAccess(org);

    // Security-review P1 — ALL reads-used-to-build-newDoc now live
    // inside the transaction. A concurrent `revoke()` or
    // `rotate()` on the same key sees a consistent snapshot; no
    // stale scopes / environment propagation into the new key.
    const { newDoc, plaintext } = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(oldRef);
      if (!freshSnap.exists) throw new NotFoundError("apiKey", oldApiKeyId);
      const current = freshSnap.data() as ApiKey;
      if (current.organizationId !== organizationId) {
        throw new NotFoundError("apiKey", oldApiKeyId);
      }
      if (current.status === "revoked") {
        // The caller is trying to rotate an already-dead key.
        // This is a UX confusion, not a security issue — reject.
        throw new AppError({
          message: "Cette clé est déjà révoquée. Créez-en une nouvelle.",
          code: ERROR_CODES.CONFLICT,
          statusCode: 409,
        });
      }
      // Mint the new key inside the tx — no intermediate state
      // between "old dead" and "new alive" is observable.
      const material = generateKeyMaterial(current.environment);
      const newName = options.name ?? `${current.name} (rotated)`;
      const newDocLocal: ApiKey = {
        id: material.hashPrefix,
        organizationId,
        name: newName,
        hashPrefix: material.hashPrefix,
        keyHash: material.keyHash,
        scopes: current.scopes,
        environment: current.environment,
        status: "active",
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
        lastUsedIp: null,
        revokedAt: null,
        revokedBy: null,
        revocationReason: null,
      };
      tx.update(oldRef, {
        status: "revoked",
        revokedAt: now,
        revokedBy: user.uid,
        revocationReason: options.reason ?? "rotated",
        updatedAt: now,
      });
      const newRef = db.collection(COLLECTIONS.API_KEYS).doc(newDocLocal.id);
      tx.create(newRef, newDocLocal);
      return { newDoc: newDocLocal, plaintext: material.plaintext };
    });

    const ctx = getRequestContext();
    eventBus.emit("api_key.revoked", {
      actorId: user.uid,
      requestId: ctx?.requestId ?? "unknown",
      timestamp: now,
      apiKeyId: oldApiKeyId,
      organizationId,
      reason: options.reason ?? "rotated",
    });
    eventBus.emit("api_key.created", {
      actorId: user.uid,
      requestId: ctx?.requestId ?? "unknown",
      timestamp: now,
      apiKeyId: newDoc.id,
      organizationId,
      scopes: newDoc.scopes,
      environment: newDoc.environment,
      name: newDoc.name,
    });
    eventBus.emit("api_key.rotated", {
      actorId: user.uid,
      requestId: ctx?.requestId ?? "unknown",
      timestamp: now,
      previousApiKeyId: oldApiKeyId,
      newApiKeyId: newDoc.id,
      organizationId,
    });

    return {
      newApiKey: { ...newDoc, keyHash: "" },
      plaintext,
      revokedApiKeyId: oldApiKeyId,
    };
  }

  /**
   * The hot path: called on every incoming API-key-authenticated
   * request. Design goals:
   *   - O(1) Firestore read (doc-id lookup on hashPrefix).
   *   - Constant-time hash comparison (no length-leak, no early-return).
   *   - NEVER throws on "bad key" — returns null so the middleware can
   *     map to a generic 401. Throwing specific errors would enable
   *     prefix-enumeration via side channels.
   *
   * `lastUsedAt` / `lastUsedIp` are updated fire-and-forget AFTER the
   * caller has been admitted. If the update fails we proceed — the
   * cost is a stale "Last used" column in the UI, not a security gap.
   */
  async verify(
    plaintext: string,
    requestIp: string | null,
    userAgent: string | null = null,
  ): Promise<{ apiKey: ApiKey; scopes: ApiKeyScope[] } | null> {
    // Kill-switch: an operator can disable API-key auth entirely via
    // `API_KEY_AUTH_DISABLED=true` without a code redeploy. Useful if
    // the `apiKeys` collection degrades and we need to steer the
    // platform back to Firebase-only auth in one flip. Configured
    // here (not in the middleware) so the switch is enforced
    // regardless of who calls verify().
    if (config.API_KEY_AUTH_DISABLED) return null;

    const parsed = parseApiKey(plaintext);
    if (!parsed) return null;

    const row = await apiKeysRepository.findById(parsed.hashPrefix);
    if (!row) return null;

    // Constant-time compare the full SHA-256 hash.
    const presentedHash = sha256Hex(plaintext);
    const match =
      Buffer.from(row.keyHash, "hex").length === Buffer.from(presentedHash, "hex").length &&
      crypto.timingSafeEqual(Buffer.from(row.keyHash, "hex"), Buffer.from(presentedHash, "hex"));
    if (!match) return null;

    // Revoked keys reject AFTER hash verification so a timing oracle
    // can't distinguish "revoked" from "wrong hash".
    if (row.status === "revoked") return null;

    // Fire-and-forget usage stamp.
    apiKeysRepository.recordUsage(row.id, requestIp).catch((err) => {
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          msg: "[api-keys] lastUsedAt bookkeeping failed",
          apiKeyId: row.id,
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
    });

    // Throttled `api_key.verified` emit. The audit trail needs a
    // stream of "key used from X" events so SOC alerting can fire on
    // "used from new IP / UA". Raw emit-per-request would flood
    // auditLogs under a normal request rate; we throttle to one emit
    // per (key, ipHash, uaHash) per hour using an in-memory map.
    // Distributed throttling across Cloud Run pods is unnecessary —
    // the signal is "new IP/UA" not "exact count" and per-pod hits
    // are strictly more accurate than ignoring repeats would be.
    const ipHash = hashShort(requestIp ?? "");
    const uaHash = hashShort(userAgent ?? "");
    const throttleKey = `${row.id}:${ipHash}:${uaHash}`;
    const nowMs = Date.now();
    const last = verifyThrottle.get(throttleKey) ?? 0;
    if (nowMs - last >= VERIFY_THROTTLE_MS) {
      verifyThrottle.set(throttleKey, nowMs);
      // Periodically trim the map so a long-running pod doesn't
      // leak memory on every distinct IP it's ever seen.
      if (verifyThrottle.size > VERIFY_THROTTLE_MAX_ENTRIES) {
        trimThrottle(nowMs);
      }
      const ctx = getRequestContext();
      eventBus.emit("api_key.verified", {
        actorId: `apikey:${row.id}`,
        requestId: ctx?.requestId ?? "unknown",
        timestamp: new Date(nowMs).toISOString(),
        apiKeyId: row.id,
        organizationId: row.organizationId,
        ipHash,
        uaHash,
      });
    }

    return { apiKey: row, scopes: row.scopes };
  }

  /**
   * Expand a set of scopes into the permission union the middleware
   * injects onto the synthetic AuthUser. Stable + deterministic.
   *
   * Return type is `Permission[]` (not `string[]`) — the middleware
   * cast to `Permission[]` was silently papering over a potential
   * drift if a scope was added to `ApiKeyScopeSchema` without a
   * matching `SCOPE_TO_PERMISSIONS` entry. Senior-review remediation.
   */
  expandScopes(scopes: ApiKeyScope[]): Permission[] {
    const seen = new Set<Permission>();
    for (const s of scopes) {
      for (const p of SCOPE_TO_PERMISSIONS[s]) seen.add(p as Permission);
    }
    return Array.from(seen);
  }

  private requireApiAccess(org: Organization): void {
    try {
      this.requirePlanFeature(org, "apiAccess");
    } catch {
      // Remap to a T2.3-specific code so the UI can show a targeted
      // upgrade CTA instead of the generic plan-limit modal.
      throw new PlanLimitError("Les clés API sont disponibles sur le plan Enterprise", {
        feature: "apiAccess",
        plan: org.effectivePlanKey ?? org.plan,
      });
    }
  }
}

export const apiKeysService = new ApiKeysService();

// Type-only export so test factories don't need FieldValue imported
// at their call sites.
export type _FieldValueShim = FieldValue;
