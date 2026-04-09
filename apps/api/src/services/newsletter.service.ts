import { z } from "zod";
import { db, COLLECTIONS } from "@/config/firebase";
import { ValidationError } from "@/errors/app-error";

// ─── Validation Schema ──────────────────────────────────────────────────────

export const NewsletterSubscribeSchema = z.object({
  email: z
    .string()
    .email("Adresse e-mail invalide")
    .max(255)
    .transform((v) => v.trim().toLowerCase()),
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
  }
}

export const newsletterService = new NewsletterService();
