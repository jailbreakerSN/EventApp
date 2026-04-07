import crypto from "node:crypto";
import { type EmailProvider, type EmailParams, type EmailResult, type BulkEmailResult } from "./email-provider.interface";
import { db, COLLECTIONS } from "@/config/firebase";

/**
 * Mock email provider for development and testing.
 * Logs emails to Firestore emailLog collection instead of sending real emails.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";

  async send(params: EmailParams): Promise<EmailResult> {
    const messageId = `email_${crypto.randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();

    await db.collection(COLLECTIONS.EMAIL_LOG).doc(messageId).set({
      id: messageId,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text ?? null,
      replyTo: params.replyTo ?? null,
      status: "delivered",
      provider: "mock",
      createdAt: now,
    });

    return { success: true, messageId };
  }

  async sendBulk(params: EmailParams[]): Promise<BulkEmailResult> {
    const results: EmailResult[] = [];
    const BATCH_SIZE = 490;

    for (let i = 0; i < params.length; i += BATCH_SIZE) {
      const chunk = params.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      const now = new Date().toISOString();

      for (const email of chunk) {
        const messageId = `email_${crypto.randomBytes(8).toString("hex")}`;
        const ref = db.collection(COLLECTIONS.EMAIL_LOG).doc(messageId);
        batch.set(ref, {
          id: messageId,
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text ?? null,
          replyTo: email.replyTo ?? null,
          status: "delivered",
          provider: "mock",
          createdAt: now,
        });
        results.push({ success: true, messageId });
      }

      await batch.commit();
    }

    return {
      total: params.length,
      sent: params.length,
      failed: 0,
      results,
    };
  }
}

export const mockEmailProvider = new MockEmailProvider();
