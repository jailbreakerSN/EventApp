import { z } from "zod";
import { db, COLLECTIONS } from "@/config/firebase";
import { config } from "@/config";
import { ValidationError } from "@/errors/app-error";
import { emailService } from "@/services/email.service";
import { resendEmailProvider } from "@/providers/resend-email.provider";
import { resolveSender } from "@/services/email/sender.registry";

// ─── Validation Schemas ─────────────────────────────────────────────────────

export const NewsletterSubscribeSchema = z.object({
  email: z
    .string()
    .email("Adresse e-mail invalide")
    .max(255)
    .transform((v) => v.trim().toLowerCase()),
});

export const NewsletterSendSchema = z.object({
  subject: z.string().min(1, "Le sujet est requis").max(200),
  htmlBody: z.string().min(1, "Le contenu HTML est requis"),
  textBody: z.string().optional(),
});

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

    // Check for existing subscriber (idempotent — don't error on duplicate)
    const existing = await db
      .collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS)
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();

    if (!existing.empty) {
      return;
    }

    const docRef = db.collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS).doc();
    await docRef.set({
      id: docRef.id,
      email: normalizedEmail,
      subscribedAt: new Date().toISOString(),
      isActive: true,
      source: "website",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mirror into the Resend Segment so future broadcasts reach them.
    const segmentId = config.RESEND_NEWSLETTER_SEGMENT_ID;
    if (segmentId) {
      void this.mirrorToSegment(segmentId, normalizedEmail);
    }

    // Welcome email (single transactional, not a broadcast — a broadcast
    // per subscriber would be wasteful and would race the mirror).
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
   * This uses Resend Broadcasts (POST /broadcasts with send=true) rather
   * than /emails/batch. Two reasons:
   *
   *   1. Broadcasts inject the one-click RFC 8058 List-Unsubscribe header
   *      per-recipient automatically and host the unsubscribe endpoint for
   *      us. Batch does not — we'd have to build that ourselves.
   *   2. Contacts with `unsubscribed: true` are skipped automatically;
   *      batch would happily send to them.
   *
   * The HTML body MUST contain `{{{RESEND_UNSUBSCRIBE_URL}}}` so Resend
   * can substitute the per-recipient unsubscribe link. `wrapNewsletterHtml`
   * enforces this by templating the token into the footer.
   */
  async sendNewsletter(
    subject: string,
    htmlBody: string,
    textBody?: string,
  ): Promise<{ broadcastId?: string; skipped?: boolean; reason?: string }> {
    const segmentId = config.RESEND_NEWSLETTER_SEGMENT_ID;
    if (!segmentId) {
      // Graceful no-op when the segment hasn't been provisioned yet — keeps
      // a half-configured staging env from surfacing as a 500 to the caller.
      return { skipped: true, reason: "RESEND_NEWSLETTER_SEGMENT_ID not configured" };
    }

    const sender = resolveSender("marketing");

    const result = await resendEmailProvider.createAndSendBroadcast({
      segmentId,
      from: sender.from,
      replyTo: sender.replyTo,
      subject,
      html: wrapNewsletterHtml(subject, htmlBody),
      ...(textBody ? { text: textBody } : {}),
      // Label for the Resend dashboard broadcast list.
      name: subject.slice(0, 100),
    });

    if (!result.success) {
      throw new Error(result.error ?? "Resend broadcast failed");
    }

    return { broadcastId: result.broadcastId };
  }
}

/**
 * Wrap newsletter content in the Teranga brand shell.
 *
 * Must include `{{{RESEND_UNSUBSCRIBE_URL}}}` for Broadcasts — Resend
 * substitutes the per-recipient unsubscribe link at send time. Without
 * this placeholder, CAN-SPAM/CASL-compliant unsubscribe is effectively
 * broken (the RFC 8058 header works, but the in-body link is the one
 * most recipients actually click).
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
