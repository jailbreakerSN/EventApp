import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — subscription renewal payment failed. Sent to the
// organization billing contact when an automatic renewal can't be charged.
// Error tone — if the user doesn't act by the grace period end, the org
// drops to the free plan and loses premium features. The notice box
// repeats the deadline so it's the last thing the user reads before the
// CTA.

export interface SubscriptionPastDueParams {
  recipientName?: string;
  organizationName: string;
  /** Display name of the plan, e.g. "Pro". */
  planName: string;
  /** Pre-formatted amount, e.g. "29 900 FCFA". */
  amount: string;
  /** Short reason surfaced by the provider (e.g. "carte expirée"). */
  failureReason?: string;
  retryUrl: string;
  /** Pre-formatted grace period end, e.g. "29 avril 2026". */
  gracePeriodEndsAt: string;
  locale?: Locale;
}

interface SubscriptionPastDueMessages {
  subject: (params: SubscriptionPastDueParams) => string;
  preview: string;
  heading: string;
  body: (params: SubscriptionPastDueParams) => string[];
  ctaLabel: string;
  noticeText: (params: SubscriptionPastDueParams) => string;
  infoRowLabels: {
    organization: string;
    plan: string;
    amount: string;
    reason: string;
    regulariseBy: string;
  };
}

const MESSAGES: Record<Locale, SubscriptionPastDueMessages> = {
  fr: {
    subject: (p) => `Paiement de l'abonnement ${p.organizationName} échoué`,
    preview: "Régularisez votre paiement avant la rétrogradation.",
    heading: "Paiement de l'abonnement échoué",
    body: (p) => [
      `Le renouvellement automatique de votre abonnement ${p.planName} pour ${p.organizationName} n'a pas pu aboutir. Montant : ${p.amount}.`,
      `Régularisez votre paiement avant le ${p.gracePeriodEndsAt}, sinon votre organisation sera automatiquement rétrogradée sur le plan gratuit et les fonctionnalités premium seront désactivées.`,
    ],
    ctaLabel: "Régulariser le paiement",
    noticeText: (p) => `Régularisez avant le ${p.gracePeriodEndsAt} pour éviter la rétrogradation.`,
    infoRowLabels: {
      organization: "Organisation",
      plan: "Plan",
      amount: "Montant",
      reason: "Motif",
      regulariseBy: "Régulariser avant",
    },
  },
  en: {
    subject: (p) => `${p.organizationName} subscription payment failed`,
    preview: "Settle your payment before the downgrade.",
    heading: "Subscription payment failed",
    body: (p) => [
      `The automatic renewal of your ${p.planName} subscription for ${p.organizationName} didn't go through. Amount: ${p.amount}.`,
      `Settle your payment by ${p.gracePeriodEndsAt}, otherwise your organization will be automatically downgraded to the free plan and premium features will be disabled.`,
    ],
    ctaLabel: "Settle payment",
    noticeText: (p) => `Settle before ${p.gracePeriodEndsAt} to avoid being downgraded.`,
    infoRowLabels: {
      organization: "Organization",
      plan: "Plan",
      amount: "Amount",
      reason: "Reason",
      regulariseBy: "Settle by",
    },
  },
  wo: {
    subject: (p) => `Paiement abonnement ${p.organizationName} antul`,
    preview: "Régulariseel sa paiement balaa rétrogradation bi.",
    heading: "Paiement abonnement antul",
    body: (p) => [
      `Renouvellement automatique bu sa abonnement ${p.planName} ngir ${p.organizationName} mënul a antu. Njëg : ${p.amount}.`,
      `Régulariseel sa paiement balaa ${p.gracePeriodEndsAt}, bu loolu amul sa organisation dinañu ko wàññi automatiquement ci plan gratuit te fonctionnalités premium yi dinañu leen fey.`,
    ],
    ctaLabel: "Régulariseel paiement bi",
    noticeText: (p) => `Régulariseel balaa ${p.gracePeriodEndsAt} ngir bañ rétrogradation bi.`,
    infoRowLabels: {
      organization: "Organisation",
      plan: "Plan",
      amount: "Njëg",
      reason: "Raison",
      regulariseBy: "Régulariseel balaa",
    },
  },
};

export function buildSubscriptionPastDueEmail(
  params: SubscriptionPastDueParams,
): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows: { label: string; value: string }[] = [
    { label: m.infoRowLabels.organization, value: params.organizationName },
    { label: m.infoRowLabels.plan, value: params.planName },
    { label: m.infoRowLabels.amount, value: params.amount },
  ];
  if (params.failureReason) {
    infoRows.push({ label: m.infoRowLabels.reason, value: params.failureReason });
  }
  infoRows.push({ label: m.infoRowLabels.regulariseBy, value: params.gracePeriodEndsAt });

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.recipientName,
    subject: m.subject(params),
    preview: m.preview,
    heading: m.heading,
    tone: "error",
    bodyParagraphs: m.body(params),
    infoRows,
    notice: m.noticeText(params),
    primaryCta: {
      label: m.ctaLabel,
      url: params.retryUrl,
    },
  });
}
