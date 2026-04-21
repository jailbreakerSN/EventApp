import crypto from "node:crypto";
import { config } from "@/config";

/**
 * Stateless confirmation token for double opt-in.
 *
 * Format:  `<subscriberId>.<expiresAtEpochMs>.<hmacBase64url>`
 *
 * The HMAC covers `subscriberId:expiresAtEpochMs` with
 * NEWSLETTER_CONFIRM_SECRET. Verification recomputes the HMAC + checks
 * expiry — no Firestore read needed, so verification is fast and works
 * during a Firestore outage. If the secret rotates, in-flight tokens
 * become invalid and users must re-subscribe (acceptable at 7-day TTL).
 *
 * Why stateless rather than storing a hash on the subscriber doc:
 *  - One less Firestore read on the hot GET /confirm path
 *  - Resubmitting the same token is naturally idempotent — no race
 *    between "check hash" and "flip status"
 *  - Tokens are single-use in practice (confirm flips the status; a
 *    second confirm on an already-confirmed subscriber is a no-op)
 *
 * Token length: roughly 20 + 13 + 44 = ~77 chars, fits comfortably in
 * an email link.
 */

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ConfirmationTokenPayload {
  subscriberId: string;
  expiresAt: number;
}

export function signConfirmationToken(
  subscriberId: string,
  options: { ttlMs?: number; now?: number } = {},
): string {
  const expiresAt = (options.now ?? Date.now()) + (options.ttlMs ?? DEFAULT_TTL_MS);
  const body = `${subscriberId}:${expiresAt}`;
  const sig = crypto
    .createHmac("sha256", config.NEWSLETTER_CONFIRM_SECRET)
    .update(body)
    .digest("base64url");
  return `${subscriberId}.${expiresAt}.${sig}`;
}

export type VerifyResult =
  | { ok: true; subscriberId: string; expiresAt: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * Verify a token. Constant-time signature comparison prevents timing
 * attacks on the HMAC. Expiry is checked after signature so a forged
 * expired token returns "bad_signature", not "expired" — less info
 * leaked to attackers probing the endpoint.
 */
export function verifyConfirmationToken(token: string, now: number = Date.now()): VerifyResult {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed" };
  }
  const [subscriberId, expiresAtRaw, sig] = parts;
  if (!subscriberId || !expiresAtRaw || !sig) {
    return { ok: false, reason: "malformed" };
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || !Number.isInteger(expiresAt) || expiresAt <= 0) {
    return { ok: false, reason: "malformed" };
  }

  const expected = crypto
    .createHmac("sha256", config.NEWSLETTER_CONFIRM_SECRET)
    .update(`${subscriberId}:${expiresAt}`)
    .digest("base64url");

  const actualBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");
  if (actualBuf.length !== expectedBuf.length) {
    return { ok: false, reason: "bad_signature" };
  }
  if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    return { ok: false, reason: "bad_signature" };
  }

  if (now > expiresAt) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, subscriberId, expiresAt };
}
