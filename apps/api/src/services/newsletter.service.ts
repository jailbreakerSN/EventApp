import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { db, COLLECTIONS } from "@/config/firebase";
import { config } from "@/config";
import { newsletterConfirmUrl } from "@/config/public-urls";
import { InternalError, NotFoundError, ValidationError } from "@/errors/app-error";
import { emailService } from "@/services/email.service";
import { resendEmailProvider } from "@/providers/resend-email.provider";
import { resolveSender } from "@/services/email/sender.registry";
import { pickDict, type Locale } from "@/services/email/i18n";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { signConfirmationToken, verifyConfirmationToken } from "./newsletter/confirmation-token";

// Double opt-in flow (Phase 3c.2):
//   subscribe() -> writes { status: "pending" } -> sends confirmation email
//   confirm()   -> verifies signed token -> flips status="confirmed"
//                  -> Firestore trigger mirrors to Resend + welcome email fires
//
// Legacy note: 3a-3b wrote { isActive: true } immediately and sent the
// welcome email on the subscribe POST. That path is gone — GDPR / CASL
// require explicit opt-in that we can prove with a timestamped consent
// record, and an immediate mirror to a marketing list doesn't satisfy that.
//
// The Resend segment mirror is still owned by the Firestore trigger
// (apps/functions/src/triggers/resend/on-subscriber-created.trigger.ts).
// That trigger now checks status === "confirmed" before mirroring so
// pending rows never land in the marketing list.

// ─── Validation Schemas ─────────────────────────────────────────────────────

export const NewsletterSubscribeSchema = z.object({
  email: z
    .string()
    .email("Adresse e-mail invalide")
    .max(255)
    .transform((v) => v.trim().toLowerCase()),
});

// 50 kB is well above a realistic newsletter (typical rich-text body ~5 kB)
// and well below anything that would stress Firestore or Resend's payload
// limits. A bound makes the XSS attack surface finite and catches the
// obvious "paste a whole PDF as HTML" footgun.
const HTML_BODY_MAX_BYTES = 50_000;

export const NewsletterSendSchema = z.object({
  subject: z.string().min(1, "Le sujet est requis").max(200),
  htmlBody: z.string().min(1, "Le contenu HTML est requis").max(HTML_BODY_MAX_BYTES),
  textBody: z.string().max(HTML_BODY_MAX_BYTES).optional(),
});

// ─── HTML sanitization (admin-supplied content) ─────────────────────────────
//
// Strict allowlist — richer than "strip all tags" so newsletters can carry
// formatting, but narrow enough that `<script>`, inline event handlers,
// `javascript:` / `data:` URIs, and `<iframe>` cannot land in subscriber
// inboxes even if a super-admin account is compromised or CSRF'd.
//
// Kept out of the service class so we can unit-test it independently.
export function sanitizeNewsletterHtml(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: [
      "p",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "strong",
      "em",
      "u",
      "s",
      "a",
      "img",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "span",
      "div",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      "*": ["style"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    // Property-value whitelist for inline styles. Without this,
    // `sanitize-html` allows the `style` attribute through but does NOT
    // validate property values — which means `style="background: url(javascript:
    // alert(1))"` and IE-era `expression(...)`/`behavior:` payloads pass
    // through unchanged. Values are matched against regex per-property;
    // only email-client-safe typography + layout CSS passes. Any URL-
    // bearing property (background-image, list-style-image, cursor, etc.)
    // is deliberately omitted from the whitelist — email clients strip
    // most of those anyway, and including them re-opens the url()
    // injection vector.
    allowedStyles: {
      "*": {
        // Hex / rgb / named color. `[a-zA-Z]+` covers "red", "blue",
        // "transparent", etc. without allowing `expression(...)` or
        // `url(...)` because those contain parens.
        color: [
          /^#(?:[0-9a-fA-F]{3}){1,2}$/,
          /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/,
          /^[a-zA-Z]{3,20}$/,
        ],
        "background-color": [
          /^#(?:[0-9a-fA-F]{3}){1,2}$/,
          /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/,
          /^[a-zA-Z]{3,20}$/,
        ],
        "text-align": [/^(?:left|right|center|justify)$/],
        "font-weight": [/^(?:normal|bold|\d{3})$/],
        "font-style": [/^(?:normal|italic)$/],
        "font-size": [/^\d+(?:\.\d+)?(?:px|em|rem|%|pt)$/],
        "line-height": [/^\d+(?:\.\d+)?(?:px|em|rem|%|)$/],
        "text-decoration": [/^(?:none|underline|line-through)$/],
        margin: [/^-?\d+(?:\.\d+)?(?:px|em|rem|%|0)(?:\s+-?\d+(?:\.\d+)?(?:px|em|rem|%|0)){0,3}$/],
        padding: [/^\d+(?:\.\d+)?(?:px|em|rem|%|0)(?:\s+\d+(?:\.\d+)?(?:px|em|rem|%|0)){0,3}$/],
        "border-radius": [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
      },
    },
    // Preserve the Resend unsubscribe placeholder — sanitize-html strips
    // unknown mustache-like content by default; wrapping it in <a> keeps
    // it intact end-to-end.
    transformTags: {},
    // Block every disallowed tag INCLUDING its text content — prevents
    // a `<script>alert(1)</script>` body from leaking the alert payload
    // as plain text.
    disallowedTagsMode: "discard",
  });
}

// ─── Service ────────────────────────────────────────────────────────────────
//
// Newsletter subscribers are dual-stored:
//   1. Firestore `newsletterSubscribers` collection — our source of truth
//      (dashboards, CSV exports, survives ESP swaps).
//   2. Resend Segment (id in RESEND_NEWSLETTER_SEGMENT_ID) — the send
//      engine's copy. Required because Resend Broadcasts only send to
//      contacts inside a Segment, and only Broadcasts give us the
//      one-click List-Unsubscribe header + automatic unsubscribe list
//      management + reputation isolation from transactional traffic.
//
// Firestore is written synchronously (subscribe can't succeed without it);
// Resend is mirrored fire-and-forget (a transient Resend outage must not
// break a user-facing subscribe form). The provider treats "contact already
// exists" as success, so the mirror is safe to re-run.

export type SubscriberStatus = "pending" | "confirmed" | "unsubscribed";

export interface SubscribeContext {
  /** Captured by the route from req.ip — part of the consent record per GDPR/CASL. */
  ipAddress?: string;
  /** Captured from the User-Agent header — non-PII forensic breadcrumb. */
  userAgent?: string;
}

export class NewsletterService {
  /**
   * Start the double-opt-in flow. Creates a `status: "pending"` row (or
   * no-ops if one already exists for this email) and sends a confirmation
   * email with a signed token. The subscriber is NOT added to the Resend
   * Segment yet — that happens on confirm().
   *
   * The HTTP response stays 200 in both the new-subscribe and
   * already-pending cases so the form gives no hint whether an email is
   * already on file (prevents enumeration attacks against the subscriber
   * list). See tests for the "idempotent subscribe" path.
   */
  async subscribe(email: string, ctx: SubscribeContext = {}): Promise<void> {
    const parsed = NewsletterSubscribeSchema.safeParse({ email });
    if (!parsed.success) {
      throw new ValidationError("Adresse e-mail invalide");
    }

    const normalizedEmail = parsed.data.email;
    const now = new Date().toISOString();
    const source = "website";

    // Suppression short-circuit (Phase 3c.6 L1 fix). If this email
    // already hard-bounced or complained, the confirmation email we're
    // about to send will itself be suppressed by emailService.sendDirect
    // and silently dropped — the user would see the generic "check your
    // inbox" response and wait forever. Fail closed here with the same
    // generic response shape so we don't leak suppression state, but
    // skip the Firestore + confirmation work entirely.
    if (await emailService.isSuppressed(normalizedEmail)) {
      return;
    }

    // Atomic "does this email already exist? if not, insert" — without the
    // transaction, two concurrent subscribe POSTs for the same address both
    // see `existing.empty === true` and both write, creating duplicate rows.
    const result = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(
        db
          .collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS)
          .where("email", "==", normalizedEmail)
          .limit(1),
      );

      if (!existingSnap.empty) {
        const existing = existingSnap.docs[0];
        const data = existing.data() as { status?: SubscriberStatus };
        return {
          created: false as const,
          existingStatus: data.status ?? "confirmed",
          existingId: existing.id,
        };
      }

      const docRef = db.collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS).doc();
      tx.set(docRef, {
        id: docRef.id,
        email: normalizedEmail,
        status: "pending" satisfies SubscriberStatus,
        // isActive kept for back-compat with any admin dashboard still
        // reading it; drops off once the UI moves to `status`.
        isActive: false,
        source,
        // Consent record fields. GDPR/CASL want who, when, how, and
        // where. Email = who, subscribedAt = when, source + userAgent
        // + ipAddress = how/where. confirmedAt is filled on confirm().
        subscribedAt: now,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return { created: true as const, subscriberId: docRef.id };
    });

    // Idempotency branches:
    //  - Existing + confirmed  → no-op. Don't re-send the welcome email.
    //  - Existing + pending    → re-send the confirmation email (user may
    //                            have lost the first one). New signed
    //                            token with fresh 7-day TTL.
    //  - Existing + unsubscribed → no-op. Respect their earlier choice;
    //                            a resurrecting subscribe must be an
    //                            explicit admin action.
    if (!result.created) {
      if (result.existingStatus === "pending") {
        await this.dispatchConfirmation(result.existingId, normalizedEmail);
      }
      return;
    }

    // Domain event — records the subscription intent even though the
    // user hasn't confirmed yet. Useful for "how many signups" metrics
    // vs. "how many confirmed". The downstream Firestore trigger gates
    // on status === "confirmed" so a pending row doesn't hit Resend.
    eventBus.emit("newsletter.subscriber_created", {
      subscriberId: result.subscriberId,
      email: normalizedEmail,
      source,
      actorId: "anonymous",
      requestId: getRequestId(),
      timestamp: now,
    });

    await this.dispatchConfirmation(result.subscriberId, normalizedEmail);
  }

  /**
   * Confirm the double-opt-in token. Idempotent — repeat confirms are
   * silent no-ops (prevents replay-attack noise in logs and keeps the
   * user-facing page happy when Gmail pre-fetches the link).
   *
   * Throws ValidationError on bad / expired tokens so the route can
   * render the right HTML status page. NotFoundError if the subscriber
   * was deleted between send and click (should never happen; defensive).
   */
  async confirm(token: string): Promise<{ alreadyConfirmed: boolean; email: string }> {
    const verification = verifyConfirmationToken(token);
    if (!verification.ok) {
      throw new ValidationError(
        verification.reason === "expired"
          ? "Ce lien de confirmation a expiré. Veuillez vous réinscrire."
          : "Ce lien de confirmation est invalide.",
      );
    }

    const { subscriberId } = verification;
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const ref = db.collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS).doc(subscriberId);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        return { found: false as const };
      }
      const data = snap.data() as {
        email: string;
        status?: SubscriberStatus;
      };
      const currentStatus = data.status ?? "confirmed";

      if (currentStatus === "confirmed") {
        return { found: true as const, alreadyConfirmed: true, email: data.email };
      }
      if (currentStatus === "unsubscribed") {
        // Re-subscribing after explicit unsubscribe requires a fresh
        // subscribe flow. Rejecting here respects the earlier choice.
        return { found: true as const, alreadyConfirmed: false, refused: true, email: data.email };
      }

      tx.update(ref, {
        status: "confirmed" satisfies SubscriberStatus,
        isActive: true, // back-compat mirror
        confirmedAt: now,
        updatedAt: now,
      });
      return { found: true as const, alreadyConfirmed: false, email: data.email };
    });

    if (!result.found) {
      throw new NotFoundError("Abonné");
    }
    if ("refused" in result && result.refused) {
      throw new ValidationError("Cette adresse s'est désinscrite. Veuillez vous réinscrire.");
    }

    if (!result.alreadyConfirmed) {
      eventBus.emit("newsletter.subscriber_confirmed", {
        subscriberId,
        email: result.email,
        confirmedAt: now,
        actorId: "anonymous",
        requestId: getRequestId(),
        timestamp: now,
      });

      // Welcome email now, not on subscribe — the welcome is the reward
      // for completing double opt-in. Also fires the Resend mirror via
      // the onNewsletterSubscriberUpdated trigger (status: pending →
      // confirmed).
      await emailService.sendWelcomeNewsletter(result.email);
    }

    return { alreadyConfirmed: result.alreadyConfirmed, email: result.email };
  }

  private async dispatchConfirmation(subscriberId: string, email: string): Promise<void> {
    const token = signConfirmationToken(subscriberId);
    const url = newsletterConfirmUrl(token);
    await emailService.sendNewsletterConfirmation(email, url);
  }

  /**
   * Send a newsletter to every contact in the Resend segment.
   * Super admin only — permission check enforced at the route level.
   *
   * Flow:
   *   1. Sanitize admin-supplied htmlBody through a strict allowlist.
   *   2. POST /broadcasts with `send: true` against the Segment. Resend
   *      injects the one-click List-Unsubscribe header per-recipient and
   *      skips contacts with `unsubscribed: true` on its own.
   *   3. Emit `newsletter.sent` for audit trail.
   *
   * Errors from Resend are wrapped in `InternalError` with a generic user
   * message; the raw detail is logged via the Fastify request logger so
   * operators can see it, but it never reaches the HTTP response body —
   * Resend error strings can carry internal identifiers (segment ids,
   * domain names) that we don't want to leak in staging/dev responses.
   */
  async sendNewsletter(params: {
    subject: string;
    htmlBody: string;
    textBody?: string;
    actorUserId: string;
    /**
     * Locale for the brand shell around the admin-authored body
     * (footer tagline + unsubscribe copy). Defaults to `fr` — our
     * primary market. Individual subscribers still receive the same
     * broadcast, so a multilingual audience means the admin picks one
     * language per broadcast. For future per-recipient variants we'd
     * split into multiple broadcasts segmented by locale.
     */
    locale?: Locale;
  }): Promise<{ broadcastId?: string; skipped?: boolean; reason?: string }> {
    const segmentId = config.RESEND_NEWSLETTER_SEGMENT_ID;
    if (!segmentId) {
      // Graceful no-op when the segment hasn't been provisioned yet.
      return { skipped: true, reason: "RESEND_NEWSLETTER_SEGMENT_ID not configured" };
    }

    const sender = resolveSender("marketing");
    const sanitizedHtml = sanitizeNewsletterHtml(params.htmlBody);

    // Defensive: sanitization should never empty the body since the schema
    // requires min(1), but if an admin manages to pass a string of only
    // disallowed tags we'd otherwise ship a broadcast with an empty body.
    if (sanitizedHtml.trim().length === 0) {
      throw new ValidationError("Le contenu HTML ne contient aucun élément autorisé");
    }

    const result = await resendEmailProvider.createAndSendBroadcast({
      segmentId,
      from: sender.from,
      replyTo: sender.replyTo,
      subject: params.subject,
      html: wrapNewsletterHtml(sanitizedHtml, params.locale),
      ...(params.textBody ? { text: params.textBody } : {}),
      name: params.subject.slice(0, 100),
    });

    if (!result.success || !result.broadcastId) {
      // Operator-only log — stays in stderr/Cloud Run logs, never touches
      // the HTTP response body. Per CLAUDE.md this is the sanctioned
      // pattern for fire-and-forget error logging in services.
      process.stderr.write(
        JSON.stringify({
          level: "error",
          event: "newsletter.send_failed",
          requestId: getRequestId(),
          actorUserId: params.actorUserId,
          resendError: result.error,
        }) + "\n",
      );
      throw new InternalError("L'envoi de la newsletter a échoué. Veuillez réessayer.");
    }

    const now = new Date().toISOString();
    eventBus.emit("newsletter.sent", {
      broadcastId: result.broadcastId,
      subject: params.subject,
      segmentId,
      actorId: params.actorUserId,
      requestId: getRequestId(),
      timestamp: now,
    });

    return { broadcastId: result.broadcastId };
  }
}

/**
 * Wrap (already-sanitized) newsletter content in the Teranga brand shell.
 *
 * Pulls footer copy from the shared email i18n dictionary (fr / en / wo)
 * so a broadcast targeting a specific segment's primary language shows
 * the right tagline + unsubscribe wording. Default `fr` matches the
 * platform's primary market.
 *
 * Must include `{{{RESEND_UNSUBSCRIBE_URL}}}` for Broadcasts — Resend
 * substitutes the per-recipient unsubscribe link at send time. Without
 * this placeholder, the visible in-body unsubscribe link (which most
 * recipients actually click) would be broken, even though the RFC 8058
 * header works.
 */
function wrapNewsletterHtml(htmlContent: string, locale?: Locale): string {
  const dict = pickDict(locale);
  const footer = dict.brand.footer;
  const unsubscribeNote = dict.welcomeNewsletter.unsubscribeNote;
  const unsubscribeLinkLabel = dict.welcomeNewsletter.unsubscribeLinkLabel;
  return `
<!DOCTYPE html>
<html lang="${dict.lang}">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; padding: 20px 0; background: #1A1A2E; border-radius: 12px 12px 0 0;">
    <h1 style="color: #D4A843; margin: 0; font-size: 24px;">Teranga</h1>
  </div>
  <div style="padding: 24px; background: #fff; border: 1px solid #eee; border-top: none;">
    ${htmlContent}
  </div>
  <div style="text-align: center; padding: 16px; color: #999; font-size: 12px;">
    <p>${footer}</p>
    <p style="margin-top: 8px;">
      ${unsubscribeNote}
      <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color: #999; text-decoration: underline;">${unsubscribeLinkLabel}</a>
    </p>
  </div>
</body>
</html>`;
}

export const newsletterService = new NewsletterService();
