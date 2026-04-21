import { z } from "zod";
import { db, COLLECTIONS } from "@/config/firebase";
import { ValidationError } from "@/errors/app-error";
import { emailService } from "@/services/email.service";

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

export class NewsletterService {
  async subscribe(email: string): Promise<void> {
    // Validate email format
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
      // Already subscribed — return silently for idempotency
      return;
    }

    // Create new subscriber document
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

    // Send welcome email (fire-and-forget). sendWelcomeNewsletter renders
    // the template, stamps the marketing sender (news@) and attaches the
    // List-Unsubscribe header from the registry.
    await emailService.sendWelcomeNewsletter(normalizedEmail);
  }

  /**
   * Send a newsletter to all active subscribers.
   * Super admin only — permission check is enforced at the route level.
   */
  async sendNewsletter(
    subject: string,
    htmlBody: string,
    textBody?: string,
  ): Promise<{ sent: number; failed: number; total: number }> {
    const BATCH_SIZE = 100; // Resend batch limit
    let sent = 0;
    let failed = 0;
    let total = 0;
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    let hasMore = true;

    while (hasMore) {
      let query = db
        .collection(COLLECTIONS.NEWSLETTER_SUBSCRIBERS)
        .where("isActive", "==", true)
        .orderBy("createdAt", "asc")
        .limit(BATCH_SIZE);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) break;
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      hasMore = snapshot.docs.length === BATCH_SIZE;

      const emails = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          to: data.email as string,
          subject,
          html: wrapNewsletterHtml(subject, htmlBody),
          ...(textBody ? { text: textBody } : {}),
        };
      });

      total += emails.length;

      // Newsletter blasts always use the marketing sender (news@).
      const result = await emailService.sendBulk(emails, "marketing");
      sent += result.sent;
      failed += result.failed;
    }

    return { sent, failed, total };
  }
}

/**
 * Wrap newsletter content in the Teranga brand template.
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
  </div>
</body>
</html>`;
}

export const newsletterService = new NewsletterService();
