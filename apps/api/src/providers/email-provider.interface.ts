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

export interface EmailProvider {
  readonly name: string;
  send(params: EmailParams): Promise<EmailResult>;
  sendBulk(params: EmailParams[]): Promise<BulkEmailResult>;
}
