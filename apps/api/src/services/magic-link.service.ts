/**
 * Organizer overhaul — Phase O10.
 *
 * Magic-link issue + verify + revoke. Tokens are HMAC-signed strings
 * (no JWT lib dependency, mirrors the QR signing pattern). The
 * persistent state lives in `magicLinks/{tokenHash}` so revocation
 * works without distributing a JWT denylist.
 *
 * Token format:
 *
 *     v1.<role>.<resourceId>.<eventId>.<expiresAtBase36>.<sig>
 *
 * The signature is the FULL HMAC-SHA256 digest (64 hex chars / 256
 * bits) over the prefix (`<role>.<resourceId>.<eventId>.<expiresAtBase36>`).
 * No truncation — same security bar as the QR signing pattern
 * documented in CLAUDE.md. URL length stays bounded under 250 chars
 * for typical resource ids, well within RFC 7230 practical limits.
 *
 * Single-use: NO. The link stays valid for the full TTL window so
 * the recipient can come back to fix typos. Revocation is the one
 * operator escape hatch — `revoke()` sets `revokedAt` on the doc and
 * subsequent `verify()` calls return 410 Gone.
 *
 * Permission: organizers (`event:update`) can issue + revoke.
 * `verify()` is intentionally unauthenticated — the URL itself is
 * the credential.
 */

import { createHmac, timingSafeEqual, createHash } from "crypto";
import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/errors/app-error";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type {
  IssueMagicLinkDto,
  MagicLink,
  MagicLinkRole,
  MagicLinkVerifyResponse,
} from "@teranga/shared-types";

const DEFAULT_TTL_HOURS = 48;
// Full HMAC-SHA256 digest length in hex (256 bits / 4 bits per hex char).
// CLAUDE.md mandates "full 64-char HMAC, no truncation" for signed
// credentials — same standard as QR badges.
const SIG_LENGTH_HEX = 64;
const TOKEN_VERSION = "v1";

class MagicLinkService extends BaseService {
  /**
   * Mint a magic link for the given resource. Stores `magicLinks/<hash>`
   * with the metadata needed for verify + revoke. Returns the
   * plaintext token (the only place it's ever exposed) plus the row
   * for the audit listener.
   */
  async issue(
    dto: IssueMagicLinkDto,
    user: AuthUser,
  ): Promise<{ token: string; record: MagicLink }> {
    this.requirePermission(user, "event:update");
    const event = await eventRepository.findByIdOrThrow(dto.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Speaker / sponsor portals are pro+ plan features per CLAUDE.md.
    // Issuing a magic link is the primary mechanism for handing out
    // portal access, so the gate lives on the issue path. The verify
    // path stays open — once a token is minted, downgrading the plan
    // doesn't invalidate links that are already in transit (better
    // UX than punishing already-invited speakers).
    const org = await organizationRepository.findByIdOrThrow(event.organizationId);
    this.requirePlanFeature(
      org,
      dto.role === "speaker" ? "speakerPortal" : "sponsorPortal",
    );

    const ttlHours = dto.ttlHours ?? DEFAULT_TTL_HOURS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
    const token = signToken({
      role: dto.role,
      resourceId: dto.resourceId,
      eventId: dto.eventId,
      expiresAt,
    });
    const tokenHash = hashToken(token);

    const record: MagicLink = {
      id: tokenHash,
      role: dto.role,
      resourceId: dto.resourceId,
      eventId: dto.eventId,
      organizationId: event.organizationId,
      recipientEmail: dto.recipientEmail.toLowerCase(),
      createdBy: user.uid,
      expiresAt: expiresAt.toISOString(),
      firstUsedAt: null,
      revokedAt: null,
      createdAt: now.toISOString(),
    };
    await db.collection(COLLECTIONS.MAGIC_LINKS).doc(tokenHash).set(record);

    // Privacy: do NOT include `recipientEmail` in the domain event
    // payload — the audit row gets `tokenHash` only, and an
    // investigator with `magic_link:read` can join to the
    // `magicLinks/{tokenHash}` doc to retrieve the recipient. Keeps
    // PII out of the immutable audit log per CLAUDE.md.
    eventBus.emit("magic_link.issued", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now.toISOString(),
      tokenHash,
      role: dto.role,
      resourceId: dto.resourceId,
      eventId: dto.eventId,
      organizationId: event.organizationId,
      expiresAt: expiresAt.toISOString(),
    });

    return { token, record };
  }

  /**
   * Verify a token. UNAUTHENTICATED endpoint by design — the URL is
   * the credential. Any tampering / expiry / revocation throws.
   * On first successful use, stamps `firstUsedAt` (best-effort, no
   * tx — the read can happen even if the stamp write races).
   */
  async verify(token: string): Promise<MagicLinkVerifyResponse> {
    const parsed = parseToken(token);
    if (!parsed) {
      throw new ValidationError("Lien invalide ou mal formé.");
    }
    if (parsed.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenError("Ce lien a expiré.");
    }
    const tokenHash = hashToken(token);
    const ref = db.collection(COLLECTIONS.MAGIC_LINKS).doc(tokenHash);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundError("Lien introuvable.");
    }
    const record = snap.data() as MagicLink;
    if (record.revokedAt) {
      throw new ForbiddenError("Ce lien a été révoqué.");
    }
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      throw new ForbiddenError("Ce lien a expiré.");
    }

    // Stamp firstUsedAt + emit `magic_link.used` once. We don't
    // gate on a transaction — duplicate writes here are benign and
    // the audit emit is fire-and-forget.
    if (!record.firstUsedAt) {
      const ts = new Date().toISOString();
      await ref.update({ firstUsedAt: ts });
      eventBus.emit("magic_link.used", {
        actorId: `magic-link:${tokenHash}`,
        requestId: getRequestId(),
        timestamp: ts,
        tokenHash,
        role: record.role,
        resourceId: record.resourceId,
        eventId: record.eventId,
        organizationId: record.organizationId,
      });
    }

    return {
      role: record.role,
      resourceId: record.resourceId,
      eventId: record.eventId,
      organizationId: record.organizationId,
      recipientEmail: record.recipientEmail,
      expiresAt: record.expiresAt,
    };
  }

  /**
   * Organizer-driven revoke. Idempotent — re-revoking is a no-op.
   *
   * Concurrent revokes by two organizers race the read+set: both see
   * `revokedAt: null`, both write `revokedAt = now(~)`, last-write-
   * wins (timestamps differ by milliseconds, no security delta), and
   * both emit `magic_link.revoked`. The duplicate audit row is
   * accepted as benign — there's no counter, no ledger, no plan-
   * limit gate, and the idempotency short-circuit below catches the
   * common single-revoke path. A transaction would only be worth
   * adding if the audit listener fans out to an outbound side
   * effect (webhook, notification) where double-firing is harmful.
   */
  async revoke(tokenHash: string, user: AuthUser): Promise<MagicLink> {
    this.requirePermission(user, "event:update");
    const ref = db.collection(COLLECTIONS.MAGIC_LINKS).doc(tokenHash);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundError("Lien introuvable.");
    const existing = snap.data() as MagicLink;
    this.requireOrganizationAccess(user, existing.organizationId);

    if (existing.revokedAt) return existing;
    const ts = new Date().toISOString();
    const next: MagicLink = { ...existing, revokedAt: ts };
    await ref.set(next);

    eventBus.emit("magic_link.revoked", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: ts,
      tokenHash,
      role: existing.role,
      resourceId: existing.resourceId,
      eventId: existing.eventId,
      organizationId: existing.organizationId,
    });

    return next;
  }
}

// ─── Pure helpers (exported for tests) ────────────────────────────────────

interface ParsedToken {
  role: MagicLinkRole;
  resourceId: string;
  eventId: string;
  expiresAt: Date;
  sig: string;
}

function getSecret(): string {
  // Reuse the QR_SECRET — same security model + same rotation story.
  // Defense in depth: if the secret rotates, all magic links become
  // invalid (which is intentional — the organizer can re-issue).
  const secret = process.env.QR_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("QR_SECRET is not configured (≥ 16 chars required)");
  }
  return secret;
}

export function signToken(args: {
  role: MagicLinkRole;
  resourceId: string;
  eventId: string;
  expiresAt: Date;
}): string {
  const expiresBase36 = args.expiresAt.getTime().toString(36);
  const prefix = `${TOKEN_VERSION}.${args.role}.${args.resourceId}.${args.eventId}.${expiresBase36}`;
  // Full 64-hex-char HMAC-SHA256 — no truncation. See CLAUDE.md
  // Security Hardening Checklist.
  const sig = createHmac("sha256", getSecret()).update(prefix).digest("hex");
  return `${prefix}.${sig}`;
}

export function parseToken(token: string): ParsedToken | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 6) return null;
  const [version, role, resourceId, eventId, expiresBase36, sig] = parts;
  if (version !== TOKEN_VERSION) return null;
  if (role !== "speaker" && role !== "sponsor") return null;
  if (!resourceId || !eventId || !expiresBase36 || !sig) return null;
  if (sig.length !== SIG_LENGTH_HEX) return null;

  const expiresMs = parseInt(expiresBase36, 36);
  if (!Number.isFinite(expiresMs) || expiresMs <= 0) return null;

  // Constant-time signature compare — same pattern as the QR codes.
  // No truncation: full 64-char HMAC-SHA256 digest.
  const prefix = `${version}.${role}.${resourceId}.${eventId}.${expiresBase36}`;
  let expectedSig: string;
  try {
    expectedSig = createHmac("sha256", getSecret()).update(prefix).digest("hex");
  } catch {
    return null;
  }
  const expected = Buffer.from(expectedSig);
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  return {
    role: role as MagicLinkRole,
    resourceId,
    eventId,
    expiresAt: new Date(expiresMs),
    sig,
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const magicLinkService = new MagicLinkService();
