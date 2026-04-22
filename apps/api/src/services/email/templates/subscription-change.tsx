import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import {
  buildNotificationTemplate,
  pickMessages,
  type NotificationTone,
} from "../components/NotificationTemplate";

// Phase 2 notification — subscription lifecycle event. Single template
// covers upgraded / downgraded / cancelled. The variant chooses the tone
// (success / warning / cancelled) and the subject + body copy; info rows
// and CTA are shared. Plan names are passed as display strings (e.g.
// "Starter", "Pro") — the caller is responsible for locale-appropriate
// formatting, which keeps this template decoupled from the PLAN_DISPLAY
// map in shared-types.

export type SubscriptionChangeKind = "upgraded" | "downgraded" | "cancelled";

export interface SubscriptionChangeParams {
  recipientName?: string;
  organizationName: string;
  kind: SubscriptionChangeKind;
  fromPlan: string;
  toPlan: string;
  /** Pre-formatted effective date, e.g. "22 avril 2026". */
  effectiveAt: string;
  billingUrl: string;
  locale?: Locale;
}

interface SubscriptionChangeMessages {
  subject: (params: SubscriptionChangeParams) => string;
  preview: (params: SubscriptionChangeParams) => string;
  heading: (params: SubscriptionChangeParams) => string;
  body: (params: SubscriptionChangeParams) => string[];
  ctaLabel: string;
  infoRowLabels: {
    organization: string;
    fromPlan: string;
    toPlan: string;
    effectiveAt: string;
  };
}

const MESSAGES: Record<Locale, SubscriptionChangeMessages> = {
  fr: {
    subject: (p) => {
      switch (p.kind) {
        case "upgraded":
          return `Abonnement ${p.organizationName} mis à niveau vers ${p.toPlan}`;
        case "downgraded":
          return `Abonnement ${p.organizationName} rétrogradé vers ${p.toPlan}`;
        case "cancelled":
          return `Abonnement ${p.organizationName} annulé`;
      }
    },
    preview: (p) => {
      switch (p.kind) {
        case "upgraded":
          return `Votre plan est maintenant ${p.toPlan}.`;
        case "downgraded":
          return `Votre plan passera à ${p.toPlan}.`;
        case "cancelled":
          return `Votre abonnement ${p.fromPlan} a été annulé.`;
      }
    },
    heading: (p) => {
      switch (p.kind) {
        case "upgraded":
          return "Votre plan a été mis à niveau";
        case "downgraded":
          return "Votre plan a été rétrogradé";
        case "cancelled":
          return "Votre abonnement a été annulé";
      }
    },
    body: (p) => {
      switch (p.kind) {
        case "upgraded":
          return [
            `Votre plan ${p.fromPlan} a été remplacé par ${p.toPlan} à compter du ${p.effectiveAt}. Vous avez maintenant accès aux nouvelles fonctionnalités.`,
          ];
        case "downgraded":
          return [
            `Votre plan passera de ${p.fromPlan} à ${p.toPlan} à compter du ${p.effectiveAt}. Certaines fonctionnalités ne seront plus disponibles à cette date.`,
          ];
        case "cancelled":
          return [
            `Votre abonnement ${p.fromPlan} a été annulé à compter du ${p.effectiveAt}. Vous repasserez automatiquement sur le plan gratuit.`,
          ];
      }
    },
    ctaLabel: "Gérer l'abonnement",
    infoRowLabels: {
      organization: "Organisation",
      fromPlan: "Ancien plan",
      toPlan: "Nouveau plan",
      effectiveAt: "Effectif le",
    },
  },
  en: {
    subject: (p) => {
      switch (p.kind) {
        case "upgraded":
          return `${p.organizationName} subscription upgraded to ${p.toPlan}`;
        case "downgraded":
          return `${p.organizationName} subscription downgraded to ${p.toPlan}`;
        case "cancelled":
          return `${p.organizationName} subscription cancelled`;
      }
    },
    preview: (p) => {
      switch (p.kind) {
        case "upgraded":
          return `You're now on ${p.toPlan}.`;
        case "downgraded":
          return `Your plan will switch to ${p.toPlan}.`;
        case "cancelled":
          return `Your ${p.fromPlan} subscription has been cancelled.`;
      }
    },
    heading: (p) => {
      switch (p.kind) {
        case "upgraded":
          return "Your plan has been upgraded";
        case "downgraded":
          return "Your plan has been downgraded";
        case "cancelled":
          return "Your subscription has been cancelled";
      }
    },
    body: (p) => {
      switch (p.kind) {
        case "upgraded":
          return [
            `Your ${p.fromPlan} plan has been replaced with ${p.toPlan} effective ${p.effectiveAt}. You now have access to the new features.`,
          ];
        case "downgraded":
          return [
            `Your plan will change from ${p.fromPlan} to ${p.toPlan} effective ${p.effectiveAt}. Some features will no longer be available from that date.`,
          ];
        case "cancelled":
          return [
            `Your ${p.fromPlan} subscription has been cancelled effective ${p.effectiveAt}. You'll automatically return to the free plan.`,
          ];
      }
    },
    ctaLabel: "Manage subscription",
    infoRowLabels: {
      organization: "Organization",
      fromPlan: "Previous plan",
      toPlan: "New plan",
      effectiveAt: "Effective",
    },
  },
  wo: {
    subject: (p) => {
      switch (p.kind) {
        case "upgraded":
          return `Abonnement ${p.organizationName} yokku na ba ${p.toPlan}`;
        case "downgraded":
          return `Abonnement ${p.organizationName} wàññiku na ba ${p.toPlan}`;
        case "cancelled":
          return `Abonnement ${p.organizationName} neenaw na`;
      }
    },
    preview: (p) => {
      switch (p.kind) {
        case "upgraded":
          return `Léegi sa plan mooy ${p.toPlan}.`;
        case "downgraded":
          return `Sa plan dina soppi ba ${p.toPlan}.`;
        case "cancelled":
          return `Sa abonnement ${p.fromPlan} neenaw nañu ko.`;
      }
    },
    heading: (p) => {
      switch (p.kind) {
        case "upgraded":
          return "Sa plan yokku na";
        case "downgraded":
          return "Sa plan wàññiku na";
        case "cancelled":
          return "Sa abonnement neenaw na";
      }
    },
    body: (p) => {
      switch (p.kind) {
        case "upgraded":
          return [
            `Sa plan ${p.fromPlan} dañu ko wuutu ak ${p.toPlan} ci ${p.effectiveAt}. Léegi am nga accès ci fonctionnalités yu bees.`,
          ];
        case "downgraded":
          return [
            `Sa plan dina jóge ci ${p.fromPlan} demal ci ${p.toPlan} ci ${p.effectiveAt}. Yenn fonctionnalités du ñu leen amati ci bés boobu.`,
          ];
        case "cancelled":
          return [
            `Sa abonnement ${p.fromPlan} neenaw nañu ko ci ${p.effectiveAt}. Dinga dellu automatiquement ci plan gratuit bi.`,
          ];
      }
    },
    ctaLabel: "Toppatoo abonnement bi",
    infoRowLabels: {
      organization: "Organisation",
      fromPlan: "Plan bu jëkk",
      toPlan: "Plan bu bees",
      effectiveAt: "Dafay jëfe ci",
    },
  },
};

function toneFor(kind: SubscriptionChangeKind): NotificationTone {
  switch (kind) {
    case "upgraded":
      return "success";
    case "downgraded":
      return "warning";
    case "cancelled":
      return "cancelled";
  }
}

export function buildSubscriptionChangeEmail(
  params: SubscriptionChangeParams,
): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.recipientName,
    subject: m.subject(params),
    preview: m.preview(params),
    heading: m.heading(params),
    tone: toneFor(params.kind),
    bodyParagraphs: m.body(params),
    infoRows: [
      { label: m.infoRowLabels.organization, value: params.organizationName },
      { label: m.infoRowLabels.fromPlan, value: params.fromPlan },
      { label: m.infoRowLabels.toPlan, value: params.toPlan },
      { label: m.infoRowLabels.effectiveAt, value: params.effectiveAt },
    ],
    primaryCta: {
      label: m.ctaLabel,
      url: params.billingUrl,
    },
  });
}
