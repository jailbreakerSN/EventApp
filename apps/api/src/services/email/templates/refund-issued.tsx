import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — successful refund initiation. Fired after the
// payment provider (Wave / Orange Money / card) has accepted the refund
// request. The settlement window varies by provider so it is passed in
// as a number of business days rather than hard-coded. No CTA — this is
// an informational confirmation the user files away with their receipts.

export interface RefundIssuedParams {
  participantName?: string;
  /** Pre-formatted refund amount, e.g. "15 000 FCFA". */
  amount: string;
  eventTitle: string;
  /** Internal refund identifier to reference when contacting support. */
  refundId: string;
  /** Provider label shown to the user, e.g. "Wave" or "Orange Money". */
  provider: string;
  /** Expected settlement window in business days (e.g. 5). */
  expectedSettlementDays: number;
  locale?: Locale;
}

interface RefundIssuedMessages {
  subject: (params: RefundIssuedParams) => string;
  preview: string;
  heading: string;
  body: (params: RefundIssuedParams) => string[];
  noticeText: string;
  infoRowLabels: {
    amount: string;
    event: string;
    refundId: string;
    provider: string;
  };
}

const MESSAGES: Record<Locale, RefundIssuedMessages> = {
  fr: {
    subject: (p) => `Remboursement effectué — ${p.amount}`,
    preview: "Votre remboursement a été initié.",
    heading: "Remboursement en cours",
    body: (p) => [
      `Votre remboursement de ${p.amount} pour ${p.eventTitle} a été initié.`,
      `Vous recevrez les fonds sur votre compte ${p.provider} d'ici ${p.expectedSettlementDays} jours ouvrés.`,
    ],
    noticeText: "Aucune action de votre part n'est nécessaire.",
    infoRowLabels: {
      amount: "Montant",
      event: "Événement",
      refundId: "Référence",
      provider: "Prestataire",
    },
  },
  en: {
    subject: (p) => `Refund issued — ${p.amount}`,
    preview: "Your refund has been initiated.",
    heading: "Refund in progress",
    body: (p) => [
      `Your refund of ${p.amount} for ${p.eventTitle} has been initiated.`,
      `You'll receive the funds on your ${p.provider} account within ${p.expectedSettlementDays} business days.`,
    ],
    noticeText: "No action is required on your side.",
    infoRowLabels: {
      amount: "Amount",
      event: "Event",
      refundId: "Reference",
      provider: "Provider",
    },
  },
  wo: {
    subject: (p) => `Delloo xaalis — ${p.amount}`,
    preview: "Sa delloo xaalis tàmbali na.",
    heading: "Delloo xaalis ci yoon bi",
    body: (p) => [
      `Sa delloo xaalis ${p.amount} ngir ${p.eventTitle} tàmbali na.`,
      `Dinga jot xaalis bi ci sa compte ${p.provider} ci ${p.expectedSettlementDays} fan bu liggéey.`,
    ],
    noticeText: "Amul dara ngay def.",
    infoRowLabels: {
      amount: "Njëg",
      event: "Événement",
      refundId: "Référence",
      provider: "Prestataire",
    },
  },
};

export function buildRefundIssuedEmail(params: RefundIssuedParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows = [
    { label: m.infoRowLabels.amount, value: params.amount },
    { label: m.infoRowLabels.event, value: params.eventTitle },
    { label: m.infoRowLabels.refundId, value: params.refundId },
    { label: m.infoRowLabels.provider, value: params.provider },
  ];

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.participantName,
    subject: m.subject(params),
    preview: m.preview,
    heading: m.heading,
    tone: "success",
    bodyParagraphs: m.body(params),
    infoRows,
    notice: m.noticeText,
  });
}
