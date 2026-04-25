/**
 * Composite rate-limit key + budget resolver — ADR-0015.
 *
 * The default `@fastify/rate-limit` registration uses a single `max` per
 * window keyed by the SHA-256 of the `Authorization` header (or `req.ip`
 * for unauthenticated requests). That works but treats every authenticated
 * caller the same — an integrator with an `terk_*` API key gets the same
 * 100 req/min as a participant on the mobile app.
 *
 * This middleware exports two functions wired into Fastify's rate-limit:
 *
 *   1. `rateLimitKeyFor(req)` — returns the bucket key:
 *        • `apikey:<hashPrefix>` when the caller authenticates with a
 *          valid-format `terk_*` API key
 *        • `user:<uid>` when the caller authenticates with a Firebase
 *          ID token (uid extracted from the `sub` claim — see security
 *          note below)
 *        • `ip:<req.ip>` for unauthenticated requests
 *
 *   2. `rateLimitMaxFor(req)` — returns the per-window budget for the
 *      bucket the request landed in (`config.RATE_LIMIT_APIKEY_MAX` /
 *      `RATE_LIMIT_USER_MAX` / `RATE_LIMIT_IP_MAX`).
 *
 * SECURITY NOTE on JWT decoding
 * ─────────────────────────────
 * `keyGenerator` runs in Fastify's `onRequest` hook — BEFORE the auth
 * middleware verifies the token signature. To extract the uid for
 * bucketing without paying the verification cost on every request, we
 * decode the JWT payload (no signature check) and read `sub`.
 *
 * Is that safe?
 *   - An attacker forging a JWT with an arbitrary `sub` lands in
 *     `user:<their-forged-uid>` — i.e. their own bucket. They can't
 *     evade rate-limiting by impersonating someone else's bucket.
 *   - Real authentication still fires at preHandler time. A forged
 *     token is rejected at 401 — bucket counter has already been
 *     decremented for that request, which is acceptable (we WANT to
 *     count failed-auth attempts toward the bucket).
 *   - Worst-case: a bot floods with random `sub` values, exhausting
 *     bucket cardinality. Mitigation: `@fastify/rate-limit` evicts
 *     expired buckets at the window boundary; a v9-onwards Redis
 *     backend bounds memory globally. Not a concern at current scale.
 *
 * `parseApiKey` does verify the format checksum (rejects typos before
 * any Firestore read), so an `terk_*` token whose checksum doesn't match
 * falls back to `ip:<req.ip>` rather than landing in a fake apikey bucket.
 */

import crypto from "node:crypto";
import { type FastifyRequest } from "fastify";
import { config } from "@/config/index";
import { parseApiKey } from "@/services/api-keys.service";

/** Three key spaces — exported for tests + observability labels. */
export type RateLimitKeySpace = "apikey" | "user" | "ip";

export interface RateLimitKeyDescriptor {
  space: RateLimitKeySpace;
  /** Stable identifier within the space (hashPrefix / uid / ip). */
  identifier: string;
}

/**
 * Decode a JWT's payload WITHOUT verifying the signature. Returns
 * `null` on any structural problem so the caller can fall through to
 * the IP bucket. Used purely for rate-limit bucketing — see the
 * security note in this file's header.
 */
function decodeJwtSubject(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1]!;
    // base64url → JSON. Pad if needed for `Buffer.from(..., 'base64')`.
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    const claims = JSON.parse(json) as { sub?: unknown };
    return typeof claims.sub === "string" && claims.sub.length > 0 ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the rate-limit bucket descriptor for a request. Pure — does
 * not mutate `req`, does not hit Firestore.
 *
 * Order of precedence:
 *   1. `terk_*` API key with a valid format checksum → `apikey:<hashPrefix>`
 *   2. Bearer JWT with a decodable `sub` claim       → `user:<uid>`
 *   3. Anything else                                  → `ip:<req.ip>`
 */
export function resolveRateLimitKey(req: FastifyRequest): RateLimitKeyDescriptor {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();

    if (token.startsWith("terk_")) {
      const parsed = parseApiKey(token);
      if (parsed) {
        return { space: "apikey", identifier: parsed.hashPrefix };
      }
      // Malformed `terk_*` token — fall through to IP bucket so a
      // typo'd key doesn't synthesise a fresh apikey bucket per typo.
    } else {
      const sub = decodeJwtSubject(token);
      if (sub) {
        return { space: "user", identifier: sub };
      }
    }
  }
  return { space: "ip", identifier: req.ip };
}

/**
 * `keyGenerator` for `@fastify/rate-limit`. Returns the namespaced key
 * string (`<space>:<id>`). Hashing IPs / uids is unnecessary —
 * `@fastify/rate-limit` keeps these in-process; they don't reach
 * external observability surfaces. API-key hashPrefix is already
 * non-secret (it IS the doc id).
 */
export function rateLimitKeyFor(req: FastifyRequest): string {
  const { space, identifier } = resolveRateLimitKey(req);
  return `${space}:${identifier}`;
}

/**
 * `max` callback for `@fastify/rate-limit`. Returns the per-window
 * budget for whichever bucket this request lands in.
 *
 * `@fastify/rate-limit` v9+ accepts `max` as `(req, key) => number`,
 * resolving the budget per-request — that's what lets us split tiers
 * without registering three separate rate-limit instances.
 */
export function rateLimitMaxFor(req: FastifyRequest): number {
  const { space } = resolveRateLimitKey(req);
  switch (space) {
    case "apikey":
      return config.RATE_LIMIT_APIKEY_MAX;
    case "user":
      return config.RATE_LIMIT_USER_MAX;
    case "ip":
      return config.RATE_LIMIT_IP_MAX;
  }
}

/**
 * Belt-and-braces hash helper. Not consumed by the current key
 * generator (we keep keys plain because the bucket store is
 * in-process), but exported so a future Redis backend can re-use the
 * same hashing convention without re-implementing it.
 */
export function hashRateLimitKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}
