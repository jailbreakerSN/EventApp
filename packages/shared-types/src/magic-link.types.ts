/**
 * Organizer overhaul — Phase O10.
 *
 * Magic-link tokens for speakers + sponsors. The organizer invites
 * an unauthenticated person via email; the link carries a signed
 * token that grants temporary scoped access ("edit your speaker bio
 * for event X") without forcing the recipient to create an account.
 *
 * Token format (HMAC-SHA256, base64url, no JWT lib dependency):
 *
 *     v1.<role>.<resourceId>.<eventId>.<expiresAtBase36>.<sig8>
 *
 * Example:
 *     v1.speaker.spk-7c2.evt-9.lqxqz.5e0a3b1c
 *
 * The signature is the truncated HMAC of the prefix
 * (`<role>.<resourceId>.<eventId>.<expiresAtBase36>`), 8 hex chars
 * (32 bits) — enough to defeat random guessing without bloating the
 * URL. We use `crypto.timingSafeEqual` on the verifier side, mirror
 * of the QR signing pattern.
 *
 * TTL: 48 hours by default (configurable). Exceeded → 410 Gone.
 *
 * Single-use: NO. The link is intentionally re-usable for the TTL
 * window so the recipient can come back to fix typos. Revocation is
 * a separate call (`revoke()` flips a `revokedAt` field on the
 * `magicLinks/<tokenHash>` doc).
 */

import { z } from "zod";

export const MagicLinkRoleSchema = z.enum(["speaker", "sponsor"]);
export type MagicLinkRole = z.infer<typeof MagicLinkRoleSchema>;

export const MagicLinkSchema = z.object({
  /** SHA-256 hash of the plaintext token — primary key. */
  id: z.string(),
  role: MagicLinkRoleSchema,
  /** Speaker id or sponsor id — the resource the link grants edit on. */
  resourceId: z.string(),
  eventId: z.string(),
  organizationId: z.string(),
  /** Email the link was sent to. Captured at issue time for audit. */
  recipientEmail: z.string().email(),
  /** Issuer uid — the organizer who minted the link. */
  createdBy: z.string(),
  expiresAt: z.string().datetime(),
  /** Set when the recipient first follows the link — analytics only. */
  firstUsedAt: z.string().datetime().nullable().default(null),
  /** Set when an organizer revokes the link manually. */
  revokedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
});
export type MagicLink = z.infer<typeof MagicLinkSchema>;

// ─── Issue DTO ───────────────────────────────────────────────────────────

export const IssueMagicLinkSchema = z.object({
  role: MagicLinkRoleSchema,
  resourceId: z.string().min(1),
  eventId: z.string().min(1),
  recipientEmail: z.string().email(),
  /** TTL override in hours. Defaults to 48. Capped at 7 days (168h). */
  ttlHours: z.number().int().positive().max(168).optional(),
});
export type IssueMagicLinkDto = z.infer<typeof IssueMagicLinkSchema>;

// ─── Verify response ─────────────────────────────────────────────────────
//
// Returned by `GET /v1/magic-links/verify?token=…`. The portal pages
// (speaker / sponsor) call this on mount, get the resource id +
// scope, then enable the right edit calls on subsequent requests.

export const MagicLinkVerifyResponseSchema = z.object({
  role: MagicLinkRoleSchema,
  resourceId: z.string(),
  eventId: z.string(),
  organizationId: z.string(),
  /** Echoes the recipient email so the UI can greet by name. */
  recipientEmail: z.string().email(),
  /** ISO timestamp until which the token stays valid. */
  expiresAt: z.string().datetime(),
});
export type MagicLinkVerifyResponse = z.infer<typeof MagicLinkVerifyResponseSchema>;
