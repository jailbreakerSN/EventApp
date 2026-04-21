import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { db, COLLECTIONS } from "@/config/firebase";
import { config } from "@/config";
import { InternalError, ValidationError } from "@/errors/app-error";
import { emailService } from "@/services/email.service";
import { resendEmailProvider } from "@/providers/resend-email.provider";
import { resolveSender } from "@/services/email/sender.registry";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

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

export class NewsletterService {
  async subscribe(email: string): Promise<void> {
    const parsed = NewsletterSubscribeSchema.safeParse({ email });
    if (!parsed.success) {
      throw new ValidationError("Adresse e-mail invalide");
    }

    const normalizedEmail = parsed.data.email;
    const now = new Date().toISOString();
    const source = "website";

    // Atomic "does this email already exist? if not, insert" — without the
    // transaction, two concurrent subscribe POSTs for the same address both
    // see `existing.empty === true` and both write, creating duplicate rows.
    // Per CLAUDE.md Security Hardening: any read-then-write MUST use
    // db.runTransaction().
    const result = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(
        db
          .collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS)
          .where("email", "==", normalizedEmail)
          .limit(1),
      );

      if (!existingSnap.empty) {
        return { created: false as const };
      }

      const docRef = db.collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS).doc();
      tx.set(docRef, {
        id: docRef.id,
        email: normalizedEmail,
        subscribedAt: now,
        isActive: true,
        source,
        createdAt: now,
        updatedAt: now,
      });
      return { created: true as const, subscriberId: docRef.id };
    });

    if (!result.created) {
      // Idempotent — already subscribed, no event, no welcome re-send.
      return;
    }

    // Domain event — audit trail + hook point for Phase 3b's Firestore
    // trigger that mirrors into the Resend Segment. Actor is "anonymous"
    // because subscribe is a public, unauthenticated endpoint.
    eventBus.emit("newsletter.subscriber_created", {
      subscriberId: result.subscriberId,
      email: normalizedEmail,
      source,
      actorId: "anonymous",
      requestId: getRequestId(),
      timestamp: now,
    });

    // Mirror into the Resend Segment so future broadcasts reach them.
    // Fire-and-forget — a Resend outage must not break subscribe. Phase 3b
    // will move this into a Firestore-triggered Cloud Function so the mirror
    // survives process restarts and retries for free.
    const segmentId = config.RESEND_NEWSLETTER_SEGMENT_ID;
    if (segmentId) {
      void this.mirrorToSegment(segmentId, normalizedEmail);
    }

    // Welcome email (single transactional, not a broadcast).
    await emailService.sendWelcomeNewsletter(normalizedEmail);
  }

  private async mirrorToSegment(segmentId: string, email: string): Promise<void> {
    try {
      await resendEmailProvider.createContact(segmentId, { email });
    } catch {
      // Fire-and-forget — SDK-level failures are already logged by withRetry.
    }
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
      html: wrapNewsletterHtml(params.subject, sanitizedHtml),
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
 * Must include `{{{RESEND_UNSUBSCRIBE_URL}}}` for Broadcasts — Resend
 * substitutes the per-recipient unsubscribe link at send time. Without
 * this placeholder, the visible in-body unsubscribe link (which most
 * recipients actually click) would be broken, even though the RFC 8058
 * header works.
 */
function wrapNewsletterHtml(subject: string, htmlContent: string): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; padding: 20px 0; background: #1A1A2E; border-radius: 12px 12px 0 0;">
    <h1 style="color: #D4A843; margin: 0; font-size: 24px;">Teranga</h1>
  </div>
  <div style="padding: 24px; background: #fff; border: 1px solid #eee; border-top: none;">
    ${htmlContent}
  </div>
  <div style="text-align: center; padding: 16px; color: #999; font-size: 12px;">
    <p>Teranga Events — La plateforme événementielle du Sénégal</p>
    <p style="margin-top: 8px;">
      Vous recevez cet e-mail parce que vous êtes inscrit à notre newsletter.
      <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color: #999; text-decoration: underline;">Se désinscrire</a>
    </p>
  </div>
</body>
</html>`;
}

export const newsletterService = new NewsletterService();
