import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2.3 — plan-limit proximity warning. Sent (at most) once per day to
// organization owners when any plan usage dimension (events, members,
// participants) crosses 80% of the plan cap. userOptOutAllowed=true because
// unlike past_due this is a nudge, not a billing emergency. Dedup is
// enforced upstream by the dispatcher's idempotency key
// `subscription_approaching_limit_${orgId}_${YYYY-MM-DD}`.

export interface SubscriptionApproachingLimitParams {
  recipientName?: string;
  organizationName: string;
  /** Display name of the plan, e.g. "Starter". */
  planName: string;
  /** Dimension label surfaced to the user, e.g. "Événements actifs". */
  dimensionLabel: string;
  /** Current usage, e.g. "8". */
  current: string;
  /** Plan cap, e.g. "10". */
  limit: string;
  /** Rounded percentage (integer), e.g. "80". */
  percent: string;
  upgradeUrl: string;
  locale?: Locale;
  unsubscribeNote?: string;
}

interface SubscriptionApproachingLimitMessages {
  subject: (params: SubscriptionApproachingLimitParams) => string;
  preview: (params: SubscriptionApproachingLimitParams) => string;
  heading: string;
  body: (params: SubscriptionApproachingLimitParams) => string[];
  ctaLabel: string;
  noticeText: (params: SubscriptionApproachingLimitParams) => string;
  infoRowLabels: {
    organization: string;
    plan: string;
    dimension: string;
    usage: string;
  };
}

const MESSAGES: Record<Locale, SubscriptionApproachingLimitMessages> = {
  fr: {
    subject: (p) => `Limite du plan ${p.planName} bientôt atteinte — ${p.organizationName}`,
    preview: (p) => `${p.dimensionLabel} : ${p.current}/${p.limit} (${p.percent}%).`,
    heading: "Votre plan arrive à saturation",
    body: (p) => [
      `Votre organisation ${p.organizationName} a atteint ${p.percent}% de la limite « ${p.dimensionLabel} » du plan ${p.planName}.`,
      `Passez à un plan supérieur pour éviter toute interruption de service ou restriction sur la création d'événements et l'inscription de participants.`,
    ],
    ctaLabel: "Voir les plans",
    noticeText: (p) => `Utilisation actuelle : ${p.current} sur ${p.limit} (${p.percent}%).`,
    infoRowLabels: {
      organization: "Organisation",
      plan: "Plan actuel",
      dimension: "Limite",
      usage: "Utilisation",
    },
  },
  en: {
    subject: (p) => `${p.planName} plan limit approaching — ${p.organizationName}`,
    preview: (p) => `${p.dimensionLabel}: ${p.current}/${p.limit} (${p.percent}%).`,
    heading: "Your plan is almost full",
    body: (p) => [
      `Your organization ${p.organizationName} has reached ${p.percent}% of the "${p.dimensionLabel}" limit on the ${p.planName} plan.`,
      `Upgrade to a higher plan to avoid any service interruption or restrictions on creating events and registering participants.`,
    ],
    ctaLabel: "View plans",
    noticeText: (p) => `Current usage: ${p.current} out of ${p.limit} (${p.percent}%).`,
    infoRowLabels: {
      organization: "Organization",
      plan: "Current plan",
      dimension: "Limit",
      usage: "Usage",
    },
  },
  wo: {
    subject: (p) => `Limite plan ${p.planName} jegesi na — ${p.organizationName}`,
    preview: (p) => `${p.dimensionLabel} : ${p.current}/${p.limit} (${p.percent}%).`,
    heading: "Sa plan bi, damay fees",
    body: (p) => [
      `Sa organisation ${p.organizationName} agsi na ${p.percent}% ci limite « ${p.dimensionLabel} » ci plan ${p.planName}.`,
      `Yokk ci plan bu gën ngir bañ ne service bi dina interrompu walla restriction ci création événement ak inscription participant.`,
    ],
    ctaLabel: "Xool plan yi",
    noticeText: (p) => `Utilisation bu bii jàmm : ${p.current} ci ${p.limit} (${p.percent}%).`,
    infoRowLabels: {
      organization: "Organisation",
      plan: "Plan bi jàmm",
      dimension: "Limite",
      usage: "Utilisation",
    },
  },
};

export function buildSubscriptionApproachingLimitEmail(
  params: SubscriptionApproachingLimitParams,
): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows: { label: string; value: string }[] = [
    { label: m.infoRowLabels.organization, value: params.organizationName },
    { label: m.infoRowLabels.plan, value: params.planName },
    { label: m.infoRowLabels.dimension, value: params.dimensionLabel },
    { label: m.infoRowLabels.usage, value: `${params.current} / ${params.limit}` },
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
      url: params.upgradeUrl,
    },
    unsubscribeNote: params.unsubscribeNote,
  });
}
