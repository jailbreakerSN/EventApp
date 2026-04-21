import {
  type EmailProvider,
  type EmailParams,
  type EmailResult,
  type BulkEmailResult,
} from "./email-provider.interface";

/**
 * Resend email provider.
 *
 * Resend is the default transactional email provider for Teranga.
 * It handles: registration confirmations, event reminders, badge delivery,
 * speaker/sponsor invitations, and organizer broadcasts.
 *
 * Key features used:
 * - Transactional email sending (REST API)
 * - Batch sending (up to 100 emails per batch call)
 * - Tags for analytics (event-related, transactional category)
 * - Attachments (badge PDFs)
 * - Idempotency keys (prevent duplicate sends on retry)
 * - Scheduled sends (for event reminders — schedule_at parameter)
 *
 * Environment variables:
 * - RESEND_API_KEY: Resend API key (re_...)
 * - RESEND_FROM_EMAIL: Verified sender email (e.g., noreply@teranga.sn)
 * - RESEND_FROM_NAME: Sender display name (e.g., "Teranga Events")
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "no-reply@terangaevent.com";
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME ?? "Teranga Events";
const DEFAULT_FROM = `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`;
const RESEND_API_URL = "https://api.resend.com";

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  async send(
    params: EmailParams & { scheduledAt?: string; idempotencyKey?: string },
  ): Promise<EmailResult> {
    const payload: Record<string, unknown> = {
      from: params.from ?? DEFAULT_FROM,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    };

    if (params.text) {
      payload.text = params.text;
    }

    if (params.replyTo) {
      payload.reply_to = params.replyTo;
    }

    if (params.attachments?.length) {
      payload.attachments = params.attachments.map((a) => ({
        content: a.content, // base64-encoded
        filename: a.filename,
        content_type: a.contentType,
      }));
    }

    // Resend-specific: tags for analytics
    if (params.tags?.length) {
      payload.tags = params.tags;
    }

    // Arbitrary RFC 5322 headers (List-Unsubscribe etc.) — Resend forwards
    // these verbatim under the top-level `headers` field of the payload.
    if (params.headers && Object.keys(params.headers).length > 0) {
      payload.headers = params.headers;
    }

    // Resend-specific: scheduled sending (ISO 8601 datetime)
    if (params.scheduledAt) {
      payload.scheduled_at = params.scheduledAt;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    };

    // Resend-specific: idempotency key to prevent duplicate sends
    if (params.idempotencyKey) {
      headers["Idempotency-Key"] = params.idempotencyKey;
    }

    const response = await fetch(`${RESEND_API_URL}/emails`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      const data = (await response.json()) as { id: string };
      return { success: true, messageId: data.id };
    }

    const errorBody = await response.text();
    return {
      success: false,
      error: `Resend error (${response.status}): ${errorBody}`,
    };
  }

  /**
   * Send multiple emails using Resend's batch endpoint.
   * Resend supports up to 100 emails per batch API call — more efficient
   * than sending one-by-one (single HTTP request instead of N).
   */
  async sendBulk(params: EmailParams[]): Promise<BulkEmailResult> {
    const results: EmailResult[] = [];
    let sent = 0;
    let failed = 0;

    // Resend batch endpoint accepts up to 100 emails per request
    const BATCH_SIZE = 100;
    for (let i = 0; i < params.length; i += BATCH_SIZE) {
      const chunk = params.slice(i, i + BATCH_SIZE);

      const batchPayload = chunk.map((p) => ({
        from: p.from ?? DEFAULT_FROM,
        to: [p.to],
        subject: p.subject,
        html: p.html,
        ...(p.text ? { text: p.text } : {}),
        ...(p.replyTo ? { reply_to: p.replyTo } : {}),
        ...(p.tags?.length ? { tags: p.tags } : {}),
        ...(p.headers && Object.keys(p.headers).length > 0 ? { headers: p.headers } : {}),
        ...(p.attachments?.length
          ? {
              attachments: p.attachments.map((a) => ({
                content: a.content,
                filename: a.filename,
                content_type: a.contentType,
              })),
            }
          : {}),
      }));

      try {
        const response = await fetch(`${RESEND_API_URL}/emails/batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify(batchPayload),
          signal: AbortSignal.timeout(30_000),
        });

        if (response.ok) {
          const data = (await response.json()) as { data: { id: string }[] };
          for (const item of data.data) {
            results.push({ success: true, messageId: item.id });
            sent++;
          }
        } else {
          const errorBody = await response.text();
          // All emails in this batch failed
          for (const _p of chunk) {
            results.push({
              success: false,
              error: `Resend batch error (${response.status}): ${errorBody}`,
            });
            failed++;
          }
        }
      } catch (err) {
        for (const _p of chunk) {
          results.push({
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
          failed++;
        }
      }
    }

    return { total: params.length, sent, failed, results };
  }
}

export const resendEmailProvider = new ResendEmailProvider();
