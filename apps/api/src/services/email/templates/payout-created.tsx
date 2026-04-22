import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — payout scheduled confirmation. Sent to the
// organization's billing contact when a payout run kicks off. The email is
// purely informational (no action required) but includes a CTA to the
// billing page where they can see the transfer status. Success tone —
// organizers love seeing money move.

export interface PayoutCreatedParams {
  organizerName?: string;
  organizationName: string;
  /** Pre-formatted amount, e.g. "245 000 FCFA". */
  amount: string;
  /** Optional — if this payout is for a single event, surface its title. Omit for consolidated payouts. */
  eventTitle?: string;
  /** Pre-formatted expected settlement date, e.g. "28 avril 2026". */
  expectedSettlementDate: string;
  /** Short reference, e.g. "PAY-2026-04-22-7F3A". */
  payoutId: string;
  billingUrl: string;
  locale?: Locale;
}

interface PayoutCreatedMessages {
  subject: (params: PayoutCreatedParams) => string;
  preview: (params: PayoutCreatedParams) => string;
  heading: string;
  body: (params: PayoutCreatedParams) => string[];
  ctaLabel: string;
  infoRowLabels: {
    amount: string;
    event: string;
    expectedDate: string;
    reference: string;
  };
}

const MESSAGES: Record<Locale, PayoutCreatedMessages> = {
  fr: {
    subject: (p) => `Virement programmé — ${p.amount}`,
    preview: (p) => `Un virement de ${p.amount} est en route.`,
    heading: "Un virement est en route",
    body: (p) => [
      `Un virement de ${p.amount} a été programmé pour ${p.organizationName}${
        p.eventTitle ? ` (événement : ${p.eventTitle})` : ""
      }.`,
      `Vous recevrez les fonds sur votre compte enregistré d'ici le ${p.expectedSettlementDate}.`,
    ],
    ctaLabel: "Voir les détails",
    infoRowLabels: {
      amount: "Montant",
      event: "Événement",
      expectedDate: "Date estimée",
      reference: "Référence",
    },
  },
  en: {
    subject: (p) => `Payout scheduled — ${p.amount}`,
    preview: (p) => `A payout of ${p.amount} is on its way.`,
    heading: "A payout is on its way",
    body: (p) => [
      `A payout of ${p.amount} has been scheduled for ${p.organizationName}${
        p.eventTitle ? ` (event: ${p.eventTitle})` : ""
      }.`,
      `You'll receive the funds in your registered account by ${p.expectedSettlementDate}.`,
    ],
    ctaLabel: "View details",
    infoRowLabels: {
      amount: "Amount",
      event: "Event",
      expectedDate: "Estimated date",
      reference: "Reference",
    },
  },
  wo: {
    subject: (p) => `Virement yón nañu ko — ${p.amount}`,
    preview: (p) => `Virement bu ${p.amount} ci yoon la.`,
    heading: "Benn virement ci yoon la",
    body: (p) => [
      `Yón nañu benn virement bu ${p.amount} ngir ${p.organizationName}${
        p.eventTitle ? ` (événement : ${p.eventTitle})` : ""
      }.`,
      `Dinga jot xaalis bi ci sa compte bi nga bind ba ${p.expectedSettlementDate}.`,
    ],
    ctaLabel: "Xool détails yi",
    infoRowLabels: {
      amount: "Njëg",
      event: "Événement",
      expectedDate: "Bés bu attendu",
      reference: "Référence",
    },
  },
};

export function buildPayoutCreatedEmail(params: PayoutCreatedParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows: { label: string; value: string }[] = [
    { label: m.infoRowLabels.amount, value: params.amount },
  ];
  if (params.eventTitle) {
    infoRows.push({ label: m.infoRowLabels.event, value: params.eventTitle });
  }
  infoRows.push({ label: m.infoRowLabels.expectedDate, value: params.expectedSettlementDate });
  infoRows.push({ label: m.infoRowLabels.reference, value: params.payoutId });

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.organizerName,
    subject: m.subject(params),
    preview: m.preview(params),
    heading: m.heading,
    tone: "success",
    bodyParagraphs: m.body(params),
    infoRows,
    primaryCta: {
      label: m.ctaLabel,
      url: params.billingUrl,
    },
  });
}
