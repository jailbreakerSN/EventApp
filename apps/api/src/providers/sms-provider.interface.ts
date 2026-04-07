/**
 * Abstract SMS provider interface.
 * Each provider (Africa's Talking, Mock) implements this interface.
 */

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface BulkSmsResult {
  total: number;
  sent: number;
  failed: number;
  results: SmsResult[];
}

export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string): Promise<SmsResult>;
  sendBulk(messages: { to: string; body: string }[]): Promise<BulkSmsResult>;
}
