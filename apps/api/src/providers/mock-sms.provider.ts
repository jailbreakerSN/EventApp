import crypto from "node:crypto";
import { type SmsProvider, type SmsResult, type BulkSmsResult } from "./sms-provider.interface";
import { db, COLLECTIONS } from "@/config/firebase";

/**
 * Mock SMS provider for development and testing.
 * Logs messages to Firestore smsLog collection instead of sending real SMS.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";

  async send(to: string, body: string): Promise<SmsResult> {
    const messageId = `sms_${crypto.randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();

    await db.collection(COLLECTIONS.SMS_LOG).doc(messageId).set({
      id: messageId,
      to,
      body,
      status: "delivered",
      provider: "mock",
      createdAt: now,
    });

    return { success: true, messageId };
  }

  async sendBulk(messages: { to: string; body: string }[]): Promise<BulkSmsResult> {
    const results: SmsResult[] = [];
    const BATCH_SIZE = 490;

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const chunk = messages.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      const now = new Date().toISOString();

      for (const msg of chunk) {
        const messageId = `sms_${crypto.randomBytes(8).toString("hex")}`;
        const ref = db.collection(COLLECTIONS.SMS_LOG).doc(messageId);
        batch.set(ref, {
          id: messageId,
          to: msg.to,
          body: msg.body,
          status: "delivered",
          provider: "mock",
          createdAt: now,
        });
        results.push({ success: true, messageId });
      }

      await batch.commit();
    }

    return {
      total: messages.length,
      sent: messages.length,
      failed: 0,
      results,
    };
  }
}

export const mockSmsProvider = new MockSmsProvider();
