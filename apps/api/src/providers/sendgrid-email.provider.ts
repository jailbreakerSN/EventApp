import {
  type EmailProvider,
  type EmailParams,
  type EmailResult,
  type BulkEmailResult,
} from "./email-provider.interface";

/**
 * SendGrid email provider.
 *
 * SendGrid is used for transactional emails: registration confirmations,
 * event reminders, badge delivery, etc.
 *
 * Environment variables:
 * - SENDGRID_API_KEY: SendGrid API key
 * - SENDGRID_FROM_EMAIL: Verified sender email (e.g., noreply@teranga.sn)
 * - SENDGRID_FROM_NAME: Sender display name (e.g., "Teranga Events")
 */

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? "";
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL ?? "no-reply@terangaevent.com";
const SENDGRID_FROM_NAME = process.env.SENDGRID_FROM_NAME ?? "Teranga Events";
const SENDGRID_API_URL = "https://api.sendgrid.com/v3/mail/send";

// "Display Name <address>" → { email, name } for SendGrid's structured shape.
// If parsing fails we keep the raw string as the email (SendGrid will reject
// it loudly, which is preferable to silently using the wrong sender).
function parseFrom(from: string | undefined): { email: string; name: string } {
  if (!from) return { email: SENDGRID_FROM_EMAIL, name: SENDGRID_FROM_NAME };
  const match = from.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1], email: match[2] };
  return { email: from, name: SENDGRID_FROM_NAME };
}

export class SendGridEmailProvider implements EmailProvider {
  readonly name = "sendgrid";

  async send(params: EmailParams): Promise<EmailResult> {
    const payload: Record<string, unknown> = {
      personalizations: [
        {
          to: [{ email: params.to }],
        },
      ],
      from: parseFrom(params.from),
      subject: params.subject,
      content: [
        ...(params.text ? [{ type: "text/plain", value: params.text }] : []),
        { type: "text/html", value: params.html },
      ],
    };

    if (params.replyTo) {
      payload.reply_to = { email: params.replyTo };
    }

    if (params.attachments?.length) {
      payload.attachments = params.attachments.map((a) => ({
        content: a.content, // base64-encoded
        filename: a.filename,
        type: a.contentType,
        disposition: "attachment",
      }));
    }

    const response = await fetch(SENDGRID_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    // SendGrid returns 202 for accepted
    if (response.status === 202 || response.ok) {
      const messageId = response.headers.get("x-message-id") ?? undefined;
      return { success: true, messageId };
    }

    const errorBody = await response.text();
    return {
      success: false,
      error: `SendGrid error (${response.status}): ${errorBody}`,
    };
  }

  async sendBulk(params: EmailParams[]): Promise<BulkEmailResult> {
    const results: EmailResult[] = [];
    let sent = 0;
    let failed = 0;

    // SendGrid rate limit: 100 emails per second for free tier
    // Process in batches of 20 with concurrency
    const BATCH_SIZE = 20;
    for (let i = 0; i < params.length; i += BATCH_SIZE) {
      const chunk = params.slice(i, i + BATCH_SIZE);
      const promises = chunk.map((p) => this.send(p));
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

    return { total: params.length, sent, failed, results };
  }
}

export const sendGridEmailProvider = new SendGridEmailProvider();
