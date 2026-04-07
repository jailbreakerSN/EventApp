import {
  type SmsProvider,
  type SmsResult,
  type BulkSmsResult,
} from "./sms-provider.interface";

/**
 * Africa's Talking SMS provider.
 *
 * Africa's Talking is the leading SMS API for Africa, with excellent
 * coverage in Senegal (+221).
 *
 * Environment variables:
 * - AT_API_KEY: Africa's Talking API key
 * - AT_USERNAME: Africa's Talking username (use "sandbox" for testing)
 * - AT_SENDER_ID: Sender ID / short code (e.g., "TERANGA")
 */

const AT_API_KEY = process.env.AT_API_KEY ?? "";
const AT_USERNAME = process.env.AT_USERNAME ?? "sandbox";
const AT_SENDER_ID = process.env.AT_SENDER_ID ?? "TERANGA";

const AT_BASE_URL =
  AT_USERNAME === "sandbox"
    ? "https://api.sandbox.africastalking.com/version1"
    : "https://api.africastalking.com/version1";

export class AfricasTalkingSmsProvider implements SmsProvider {
  readonly name = "africastalking";

  async send(to: string, body: string): Promise<SmsResult> {
    const formData = new URLSearchParams({
      username: AT_USERNAME,
      to: normalizePhone(to),
      message: body,
      from: AT_SENDER_ID,
    });

    const response = await fetch(`${AT_BASE_URL}/messaging`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        apiKey: AT_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `AT API error (${response.status}): ${text}` };
    }

    const data = (await response.json()) as {
      SMSMessageData: {
        Message: string;
        Recipients: Array<{
          statusCode: number;
          number: string;
          status: string;
          messageId: string;
        }>;
      };
    };

    const recipient = data.SMSMessageData.Recipients[0];
    if (!recipient) {
      return { success: false, error: "No recipient in response" };
    }

    // Status codes 100 and 101 indicate success
    const success = recipient.statusCode === 100 || recipient.statusCode === 101;
    return {
      success,
      messageId: recipient.messageId,
      error: success ? undefined : recipient.status,
    };
  }

  async sendBulk(messages: { to: string; body: string }[]): Promise<BulkSmsResult> {
    // Africa's Talking supports bulk via comma-separated recipients
    // but only for the same message. For different messages, send individually.
    const results: SmsResult[] = [];
    let sent = 0;
    let failed = 0;

    // Send in batches of 50 to respect rate limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const chunk = messages.slice(i, i + BATCH_SIZE);
      const promises = chunk.map((msg) => this.send(msg.to, msg.body));
      const batchResults = await Promise.allSettled(promises);

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
          if (result.value.success) sent++;
          else failed++;
        } else {
          results.push({ success: false, error: result.reason?.message ?? "Unknown error" });
          failed++;
        }
      }
    }

    return { total: messages.length, sent, failed, results };
  }
}

/**
 * Normalize a Senegalese phone number to international format.
 * +221 77 XXX XX XX → +221XXXXXXXXX
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00221")) return `+${digits.slice(2)}`;
  if (digits.startsWith("221")) return `+${digits}`;
  // Assume Senegalese local number
  if (digits.length === 9) return `+221${digits}`;
  return digits;
}

export const africasTalkingSmsProvider = new AfricasTalkingSmsProvider();
