/**
 * Provider registry — selects real or mock providers based on environment config.
 *
 * In development (no API keys set), all providers fall back to mock.
 * In production, real providers are used when configured.
 *
 * Email *templates* used to live here as inline HTML; they have moved to
 * `src/services/email/templates/*.tsx` (react-email). Import the
 * `build*Email` helpers from `@/services/email/templates` instead.
 */

import { type SmsProvider } from "./sms-provider.interface";
import { type EmailProvider } from "./email-provider.interface";
import { mockSmsProvider } from "./mock-sms.provider";
import { mockEmailProvider } from "./mock-email.provider";
import { africasTalkingSmsProvider } from "./africastalking-sms.provider";
import { resendEmailProvider } from "./resend-email.provider";
import { sendGridEmailProvider } from "./sendgrid-email.provider";

// ─── SMS Provider ───────────────────────────────────────────────────────────

const HAS_AT = !!process.env.AT_API_KEY;

export function getSmsProvider(): SmsProvider {
  return HAS_AT ? africasTalkingSmsProvider : mockSmsProvider;
}

// ─── Email Provider ─────────────────────────────────────────────────────────
// Priority: Resend (default) > SendGrid (fallback) > Mock (dev)

const HAS_RESEND = !!process.env.RESEND_API_KEY;
const HAS_SENDGRID = !!process.env.SENDGRID_API_KEY;

export function getEmailProvider(): EmailProvider {
  if (HAS_RESEND) return resendEmailProvider;
  if (HAS_SENDGRID) return sendGridEmailProvider;
  return mockEmailProvider;
}

// ─── SMS Templates ──────────────────────────────────────────────────────────
// All French, < 160 chars (single SMS segment).
// SMS stays here because it's plain strings; email templates are now
// react-email components in src/services/email/templates/.

export const SMS_TEMPLATES = {
  registrationConfirmed: (eventTitle: string) =>
    `Teranga: Inscription confirmée pour "${eventTitle.slice(0, 60)}". Votre badge QR est disponible dans l'app. À bientôt !`,

  paymentConfirmed: (eventTitle: string, amount: string) =>
    `Teranga: Paiement de ${amount} reçu pour "${eventTitle.slice(0, 50)}". Inscription confirmée. Badge QR disponible.`,

  eventReminder24h: (eventTitle: string, date: string) =>
    `Teranga: Rappel — "${eventTitle.slice(0, 50)}" c'est demain (${date}). Préparez votre badge QR !`,

  eventReminder1h: (eventTitle: string) =>
    `Teranga: "${eventTitle.slice(0, 70)}" commence dans 1h ! Ouvrez l'app pour votre badge QR.`,

  registrationApproved: (eventTitle: string) =>
    `Teranga: Votre inscription à "${eventTitle.slice(0, 60)}" a été approuvée. Badge QR disponible !`,
} as const;
