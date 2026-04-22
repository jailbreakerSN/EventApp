import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — refund attempt failed. Sent to the payer when
// the provider rejects the refund payload (account closed, expired card,
// unsupported corridor, etc.). Error tone plus a support CTA so the user
// can follow up — the support team is separately notified by the refund
// worker so they already have the context when the user reaches out.

export interface RefundFailedParams {
  participantName?: string;
  /** Pre-formatted refund amount, e.g. "15 000 FCFA". */
  amount: string;
  eventTitle: string;
  /** Optional short reason string surfaced by the provider. */
  failureReason?: string;
  /** URL to the support contact form or chat. */
  supportUrl: string;
  locale?: Locale;
}

interface RefundFailedMessages {
  subject: (params: RefundFailedParams) => string;
  preview: string;
  heading: string;
  body: (params: RefundFailedParams) => string[];
  ctaLabel: string;
  infoRowLabels: {
    amount: string;
    event: string;
    reason: string;
  };
}

const MESSAGES: Record<Locale, RefundFailedMessages> = {
  fr: {
    subject: (p) => `Remboursement échoué — ${p.eventTitle}`,
    preview: "Nous n'avons pas pu traiter votre remboursement — le support vous contacte.",
    heading: "Problème avec votre remboursement",
    body: (p) => [
      `Nous n'avons pas pu traiter votre remboursement de ${p.amount} pour ${p.eventTitle}.`,
      "Notre équipe support a été notifiée et vous recontactera sous 48h pour résoudre la situation.",
    ],
    ctaLabel: "Contacter le support",
    infoRowLabels: {
      amount: "Montant",
      event: "Événement",
      reason: "Raison",
    },
  },
  en: {
    subject: (p) => `Refund failed — ${p.eventTitle}`,
    preview: "We couldn't process your refund — support will reach out.",
    heading: "There's a problem with your refund",
    body: (p) => [
      `We couldn't process your refund of ${p.amount} for ${p.eventTitle}.`,
      "Our support team has been notified and will contact you within 48 hours to resolve the issue.",
    ],
    ctaLabel: "Contact support",
    infoRowLabels: {
      amount: "Amount",
      event: "Event",
      reason: "Reason",
    },
  },
  wo: {
    subject: (p) => `Delloo xaalis antul — ${p.eventTitle}`,
    preview: "Mënunu delloosi sa xaalis — support bi dina la jokkool.",
    heading: "Am na jafe-jafe ci sa delloo xaalis",
    body: (p) => [
      `Mënunu delloosi sa xaalis ${p.amount} ngir ${p.eventTitle}.`,
      "Équipe support bi xam nañu ko te dinañu la jokkool ci 48 waxtu ngir xoolaat loolu.",
    ],
    ctaLabel: "Jokkool ak support bi",
    infoRowLabels: {
      amount: "Njëg",
      event: "Événement",
      reason: "Raison",
    },
  },
};

export function buildRefundFailedEmail(params: RefundFailedParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows = [
    { label: m.infoRowLabels.amount, value: params.amount },
    { label: m.infoRowLabels.event, value: params.eventTitle },
  ];
  if (params.failureReason) {
    infoRows.push({ label: m.infoRowLabels.reason, value: params.failureReason });
  }

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.participantName,
    subject: m.subject(params),
    preview: m.preview,
    heading: m.heading,
    tone: "error",
    bodyParagraphs: m.body(params),
    infoRows,
    primaryCta: {
      label: m.ctaLabel,
      url: params.supportUrl,
    },
  });
}
