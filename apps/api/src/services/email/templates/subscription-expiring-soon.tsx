import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2.3 — 7-day renewal reminder. Sent daily by the subscription
// reminder cron when a paid subscription is exactly 7 days from its
// current period end. Mandatory (billing category) so it ignores the
// user opt-out table — organizers can't miss a renewal because of a
// preference setting.

export interface SubscriptionExpiringSoonParams {
  recipientName?: string;
  organizationName: string;
  /** Display name of the plan, e.g. "Pro". */
  planName: string;
  /** Pre-formatted amount due, e.g. "29 900 FCFA". */
  amount: string;
  /** Pre-formatted renewal date (YYYY-MM-DD-ish). */
  renewalDate: string;
  /** Days remaining before renewal — surfaced in the notice box. */
  daysUntilRenewal: number;
  manageBillingUrl: string;
  locale?: Locale;
}

interface SubscriptionExpiringSoonMessages {
  subject: (params: SubscriptionExpiringSoonParams) => string;
  preview: (params: SubscriptionExpiringSoonParams) => string;
  heading: string;
  body: (params: SubscriptionExpiringSoonParams) => string[];
  ctaLabel: string;
  noticeText: (params: SubscriptionExpiringSoonParams) => string;
  infoRowLabels: {
    organization: string;
    plan: string;
    amount: string;
    renewalDate: string;
  };
}

const MESSAGES: Record<Locale, SubscriptionExpiringSoonMessages> = {
  fr: {
    subject: (p) => `Renouvellement de l'abonnement ${p.organizationName} dans ${p.daysUntilRenewal} jours`,
    preview: (p) => `Renouvellement de ${p.planName} prévu le ${p.renewalDate}.`,
    heading: "Votre abonnement arrive à échéance",
    body: (p) => [
      `L'abonnement ${p.planName} de ${p.organizationName} sera renouvelé automatiquement le ${p.renewalDate}. Montant prélevé : ${p.amount}.`,
      `Si vous souhaitez modifier votre moyen de paiement, changer de plan ou annuler, faites-le avant cette date depuis la page de facturation.`,
    ],
    ctaLabel: "Gérer mon abonnement",
    noticeText: (p) => `Renouvellement automatique dans ${p.daysUntilRenewal} jours (${p.renewalDate}).`,
    infoRowLabels: {
      organization: "Organisation",
      plan: "Plan",
      amount: "Montant",
      renewalDate: "Prochain renouvellement",
    },
  },
  en: {
    subject: (p) => `${p.organizationName} subscription renews in ${p.daysUntilRenewal} days`,
    preview: (p) => `${p.planName} renews on ${p.renewalDate}.`,
    heading: "Your subscription is about to renew",
    body: (p) => [
      `The ${p.planName} subscription for ${p.organizationName} will renew automatically on ${p.renewalDate}. Amount: ${p.amount}.`,
      `To update your payment method, switch plans, or cancel, please do so before that date from the billing page.`,
    ],
    ctaLabel: "Manage subscription",
    noticeText: (p) => `Automatic renewal in ${p.daysUntilRenewal} days (${p.renewalDate}).`,
    infoRowLabels: {
      organization: "Organization",
      plan: "Plan",
      amount: "Amount",
      renewalDate: "Next renewal",
    },
  },
  wo: {
    subject: (p) => `Renouvellement abonnement ${p.organizationName} ci ${p.daysUntilRenewal} fan`,
    preview: (p) => `${p.planName} dina renouveler ci ${p.renewalDate}.`,
    heading: "Sa abonnement damay jeex",
    body: (p) => [
      `Abonnement ${p.planName} bu ${p.organizationName} dina renouveler boppam ci ${p.renewalDate}. Njëg : ${p.amount}.`,
      `Bu nga bëgg a soppi sa mode paiement, soppi plan walla neenal, defal ko balaa bés boobu ci page facturation bi.`,
    ],
    ctaLabel: "Yor sa abonnement",
    noticeText: (p) => `Renouvellement automatique ci ${p.daysUntilRenewal} fan (${p.renewalDate}).`,
    infoRowLabels: {
      organization: "Organisation",
      plan: "Plan",
      amount: "Njëg",
      renewalDate: "Renouvellement ci kanam",
    },
  },
};

export function buildSubscriptionExpiringSoonEmail(
  params: SubscriptionExpiringSoonParams,
): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows: { label: string; value: string }[] = [
    { label: m.infoRowLabels.organization, value: params.organizationName },
    { label: m.infoRowLabels.plan, value: params.planName },
    { label: m.infoRowLabels.amount, value: params.amount },
    { label: m.infoRowLabels.renewalDate, value: params.renewalDate },
  ];

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.recipientName,
    subject: m.subject(params),
    preview: m.preview(params),
    heading: m.heading,
    tone: "warning",
    bodyParagraphs: m.body(params),
    infoRows,
    notice: m.noticeText(params),
    primaryCta: {
      label: m.ctaLabel,
      url: params.manageBillingUrl,
    },
  });
}
