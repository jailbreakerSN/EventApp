import crypto from "node:crypto";
import { type EmailCategory } from "@teranga/shared-types";
import { config } from "@/config";

/**
 * Stateless unsubscribe token for the subscriber-facing List-Unsubscribe
 * endpoint (RFC 8058 one-click + browser GET).
 *
 * Format: `<userIdBase64url>.<category>.<sigBase64url>`
 *
 * Design choices
 *  - NO expiry: users click an email from months ago and the link still
 *    works. Rotating UNSUBSCRIBE_SECRET invalidates every outstanding
 *    link at once; recipients fall back to the in-app Settings page.
 *  - Category is part of the signed payload so a token for
 *    `transactional` can't be replayed to unsubscribe from
 *    `organizational` (or vice versa).
 *  - userId is base64url-encoded so a future non-Firebase uid with
 *    `.` characters doesn't break the delimiter.
 *
 * Only non-mandatory categories can produce a valid token —
 * `signUnsubscribeToken("auth" | "billing", ...)` throws at the call
 * site because those categories cannot be unsubscribed from. The
 * guardrail lives in the service layer (see notifications.service.ts
 * `unsubscribeCategory`) so this module stays pure.
 */

export type UnsubscribableCategory = Exclude<EmailCategory, "auth" | "billing">;

const UNSUBSCRIBABLE: ReadonlySet<string> = new Set<UnsubscribableCategory>([
  "transactional",
  "organizational",
  "marketing",
]);

export function signUnsubscribeToken(userId: string, category: UnsubscribableCategory): string {
  if (!userId) throw new Error("signUnsubscribeToken: userId is required");
  const userIdEnc = Buffer.from(userId, "utf8").toString("base64url");
  const body = `${userIdEnc}.${category}`;
  const sig = crypto
    .createHmac("sha256", config.UNSUBSCRIBE_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export type UnsubscribeVerifyResult =
  | { ok: true; userId: string; category: UnsubscribableCategory }
  | { ok: false; reason: "malformed" | "bad_signature" | "unknown_category" };

export function verifyUnsubscribeToken(token: string): UnsubscribeVerifyResult {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed" };
  }
  const [userIdEnc, category, sig] = parts;
  if (!userIdEnc || !category || !sig) {
    return { ok: false, reason: "malformed" };
  }

  // Narrow the untrusted category string to the allowed set BEFORE any
  // HMAC work — prevents wasted CPU on obviously bogus tokens.
  if (!UNSUBSCRIBABLE.has(category)) {
    return { ok: false, reason: "unknown_category" };
  }

  const expected = crypto
    .createHmac("sha256", config.UNSUBSCRIBE_SECRET)
    .update(`${userIdEnc}.${category}`)
    .digest("base64url");

  const actualBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");
  if (actualBuf.length !== expectedBuf.length) {
    return { ok: false, reason: "bad_signature" };
  }
  if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    return { ok: false, reason: "bad_signature" };
  }

  let userId: string;
  try {
    userId = Buffer.from(userIdEnc, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!userId) {
    return { ok: false, reason: "malformed" };
  }

  return { ok: true, userId, category: category as UnsubscribableCategory };
}
