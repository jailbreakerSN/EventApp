import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — payment failure alert. Sent to the payer when a
// Wave / Orange Money / card charge does not go through. The message is
// intentionally reassuring ("no amount was debited") to reduce support
// tickets, and drives the user back to a retry URL. Error tone colours the
// heading + notice box in red accents.

export interface PaymentFailedParams {
  participantName?: string;
  /** Pre-formatted amount, e.g. "25 000 FCFA". */
  amount: string;
  eventTitle: string;
  /** Optional short reason string surfaced by the provider (e.g. "solde insuffisant"). */
  failureReason?: string;
  /** URL back to the checkout retry screen. */
  retryUrl: string;
  locale?: Locale;
}

interface PaymentFailedMessages {
  subject: (params: PaymentFailedParams) => string;
  preview: string;
  heading: string;
  body: (params: PaymentFailedParams) => string[];
  ctaLabel: string;
  noticeText: string;
  infoRowLabels: {
    amount: string;
    event: string;
    reason: string;
  };
}

const MESSAGES: Record<Locale, PaymentFailedMessages> = {
  fr: {
    subject: (p) => `Paiement échoué — ${p.eventTitle}`,
    preview: "Votre paiement n'a pas abouti — votre place est maintenue 24h.",
    heading: "Votre paiement n'a pas abouti",
    body: (p) => [
      `Nous n'avons pas pu finaliser votre paiement de ${p.amount} pour ${p.eventTitle}.`,
      "Votre place est maintenue pendant 24h. Merci de réessayer via le bouton ci-dessous.",
    ],
    ctaLabel: "Réessayer le paiement",
    noticeText:
      "Aucun montant n'a été débité. Si le problème persiste, contactez-nous à support@terangaevent.com.",
    infoRowLabels: {
      amount: "Montant",
      event: "Événement",
      reason: "Raison",
    },
  },
  en: {
    subject: (p) => `Payment failed — ${p.eventTitle}`,
    preview: "Your payment didn't go through — your spot is held for 24 hours.",
    heading: "Your payment didn't go through",
    body: (p) => [
      `We couldn't complete your payment of ${p.amount} for ${p.eventTitle}.`,
      "Your spot is held for 24 hours. Please try again using the button below.",
    ],
    ctaLabel: "Retry payment",
    noticeText:
      "No amount was charged. If the issue continues, contact us at support@terangaevent.com.",
    infoRowLabels: {
      amount: "Amount",
      event: "Event",
      reason: "Reason",
    },
  },
  wo: {
    subject: (p) => `Paiement bi antul — ${p.eventTitle}`,
    preview: "Sa paiement antul — sa place maintenu na 24 waxtu.",
    heading: "Sa paiement antul",
    body: (p) => [
      `Mënunu a mujj sa paiement ${p.amount} ngir ${p.eventTitle}.`,
      "Sa place maintenu na ci 24 waxtu. Jéemaat ak bouton bi ci suuf.",
    ],
    ctaLabel: "Jéemaat paiement bi",
    noticeText:
      "Amul xaalis bu ñu jël. Su probléem bi wéy, jokkool ak nu ci support@terangaevent.com.",
    infoRowLabels: {
      amount: "Njëg",
      event: "Événement",
      reason: "Raison",
    },
  },
};

export function buildPaymentFailedEmail(params: PaymentFailedParams): Promise<RenderedEmail> {
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
      url: params.retryUrl,
    },
    notice: m.noticeText,
  });
}
