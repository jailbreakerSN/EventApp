// Phase C.2 — Web Push client / Phase C.1 server contract.
//
// The API identifies FCM tokens by `sha256(token).slice(0, 16)` (16 hex
// chars). The raw token never leaves the browser except on POST /v1/me/
// fcm-tokens, and all subsequent mutations (delete-one, dedupe, audit) are
// addressed by fingerprint. The client MUST compute the same value so
// DELETE /v1/me/fcm-tokens/:fp hits the right entry on the user doc.
//
// Why 16 hex chars and not the full digest: the per-user cap is 10 tokens,
// 64 bits of entropy is collision-free at that scale, and the short form
// fits cleanly in audit-log detail rows without bloating them.
//
// Server counterpart: apps/api/src/services/fcm-tokens.service.ts
// `fingerprintToken()`. Keep the two implementations byte-for-byte
// identical — a drift here would silently break token revoke.
export async function fingerprintToken(token: string): Promise<string> {
  const enc = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
