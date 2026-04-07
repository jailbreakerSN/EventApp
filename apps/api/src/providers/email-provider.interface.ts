/**
 * Abstract email provider interface.
 * Each provider (SendGrid, Resend, Mock) implements this interface.
 */

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
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
