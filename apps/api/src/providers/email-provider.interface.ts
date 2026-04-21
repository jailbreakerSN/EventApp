/**
 * Abstract email provider interface.
 * Each provider (SendGrid, Resend, Mock) implements this interface.
 */

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /**
   * Full From value in "Display Name <address>" format.
   * When omitted, providers fall back to their own env-configured default
   * (RESEND_FROM_EMAIL / SENDGRID_FROM_EMAIL) for backward compatibility.
   * Callers should normally go through EmailService, which stamps this via
   * the sender registry keyed by EmailCategory.
   */
  from?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
  /**
   * Arbitrary RFC 5322 headers. Used today for List-Unsubscribe (RFC 8058)
   * on marketing sends, and reserved for any future provider-agnostic
   * header requirements (e.g., Feedback-ID for large-volume senders).
   */
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string; contentType: string }[];
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface BulkEmailResult {
  total: number;
  sent: number;
  failed: number;
  results: EmailResult[];
}

export interface BulkSendOptions {
  /**
   * Optional batch-level idempotency key. Resend dedupes repeated batches
   * against this key for 24h. Providers that don't support idempotency
   * ignore it silently — it's advisory, not load-bearing.
   */
  idempotencyKey?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(params: EmailParams): Promise<EmailResult>;
  sendBulk(params: EmailParams[], options?: BulkSendOptions): Promise<BulkEmailResult>;
}
