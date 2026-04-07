/**
 * Provider registry — selects real or mock providers based on environment config.
 *
 * In development (no API keys set), all providers fall back to mock.
 * In production, real providers are used when configured.
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
// All French, < 160 chars (single SMS segment)

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

// ─── Email Templates ────────────────────────────────────────────────────────

export function buildRegistrationEmail(params: {
  participantName: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  ticketName: string;
  registrationId: string;
  badgeUrl?: string;
}): { subject: string; html: string; text: string } {
  const subject = `Inscription confirmée — ${params.eventTitle}`;
  const text = [
    `Bonjour ${params.participantName},`,
    ``,
    `Votre inscription à "${params.eventTitle}" est confirmée !`,
    ``,
    `Date : ${params.eventDate}`,
    `Lieu : ${params.eventLocation}`,
    `Billet : ${params.ticketName}`,
    ``,
    params.badgeUrl
      ? `Téléchargez votre badge : ${params.badgeUrl}`
      : `Votre badge QR sera disponible dans l'application.`,
    ``,
    `À bientôt !`,
    `L'équipe Teranga`,
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; padding: 20px 0; background: #1A1A2E; border-radius: 12px 12px 0 0;">
    <h1 style="color: #D4A843; margin: 0; font-size: 24px;">Teranga</h1>
  </div>
  <div style="padding: 24px; background: #fff; border: 1px solid #eee; border-top: none;">
    <h2 style="margin-top: 0;">Inscription confirmée !</h2>
    <p>Bonjour <strong>${escapeHtml(params.participantName)}</strong>,</p>
    <p>Votre inscription à <strong>${escapeHtml(params.eventTitle)}</strong> est confirmée.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 8px 0; color: #666;">Date</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.eventDate)}</td></tr>
      <tr><td style="padding: 8px 0; color: #666;">Lieu</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.eventLocation)}</td></tr>
      <tr><td style="padding: 8px 0; color: #666;">Billet</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.ticketName)}</td></tr>
    </table>
    ${params.badgeUrl
      ? `<a href="${escapeHtml(params.badgeUrl)}" style="display: inline-block; background: #D4A843; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 8px;">Télécharger mon badge</a>`
      : `<p style="background: #f8f9fa; padding: 12px; border-radius: 8px; text-align: center;">Votre badge QR sera disponible dans l'application.</p>`
    }
  </div>
  <div style="text-align: center; padding: 16px; color: #999; font-size: 12px;">
    <p>Teranga Events — La plateforme événementielle du Sénégal</p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

export function buildEventReminderEmail(params: {
  participantName: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  timeUntil: string;
}): { subject: string; html: string; text: string } {
  const subject = `Rappel — ${params.eventTitle} ${params.timeUntil}`;
  const text = [
    `Bonjour ${params.participantName},`,
    ``,
    `Rappel : "${params.eventTitle}" commence ${params.timeUntil} !`,
    ``,
    `Date : ${params.eventDate}`,
    `Lieu : ${params.eventLocation}`,
    ``,
    `N'oubliez pas votre badge QR !`,
    ``,
    `L'équipe Teranga`,
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="text-align: center; padding: 20px 0; background: #1A1A2E; border-radius: 12px 12px 0 0;">
    <h1 style="color: #D4A843; margin: 0; font-size: 24px;">Teranga</h1>
  </div>
  <div style="padding: 24px; background: #fff; border: 1px solid #eee; border-top: none;">
    <h2 style="margin-top: 0;">Rappel : ${escapeHtml(params.timeUntil)}</h2>
    <p>Bonjour <strong>${escapeHtml(params.participantName)}</strong>,</p>
    <p><strong>${escapeHtml(params.eventTitle)}</strong> commence ${escapeHtml(params.timeUntil)} !</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 8px 0; color: #666;">Date</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.eventDate)}</td></tr>
      <tr><td style="padding: 8px 0; color: #666;">Lieu</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.eventLocation)}</td></tr>
    </table>
    <p style="background: #fef3c7; padding: 12px; border-radius: 8px; text-align: center; font-weight: 600;">N'oubliez pas votre badge QR !</p>
  </div>
  <div style="text-align: center; padding: 16px; color: #999; font-size: 12px;">
    <p>Teranga Events — La plateforme événementielle du Sénégal</p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
