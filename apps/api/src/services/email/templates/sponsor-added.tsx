import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — sponsor added to an event. Sent to the primary
// contact of a sponsor organization once they've been officially linked to
// an event. Drives traffic to the sponsor portal where they customise their
// booth, collect leads and view live stats. Success tone.

export interface SponsorAddedParams {
  /** Contact person at the sponsor organization (optional — organizations without a named contact get a generic greeting). */
  sponsorContactName?: string;
  organizationName: string;
  eventTitle: string;
  /** Pre-formatted date, e.g. "15 mai 2026". */
  eventDate: string;
  portalUrl: string;
  locale?: Locale;
}

interface SponsorAddedMessages {
  subject: (params: SponsorAddedParams) => string;
  preview: string;
  heading: (params: SponsorAddedParams) => string;
  body: (params: SponsorAddedParams) => string[];
  ctaLabel: string;
  infoRowLabels: {
    event: string;
    date: string;
  };
}

const MESSAGES: Record<Locale, SponsorAddedMessages> = {
  fr: {
    subject: (p) => `${p.organizationName} est sponsor de ${p.eventTitle}`,
    preview: "Votre partenariat sponsor est officiel.",
    heading: (p) => `Merci de sponsoriser ${p.eventTitle}`,
    body: (p) => [
      `Votre organisation ${p.organizationName} est officiellement partenaire de ${p.eventTitle}. Depuis l'espace sponsor vous pouvez personnaliser votre stand, gérer vos leads et accéder aux statistiques en temps réel.`,
    ],
    ctaLabel: "Accéder à l'espace sponsor",
    infoRowLabels: {
      event: "Événement",
      date: "Date",
    },
  },
  en: {
    subject: (p) => `${p.organizationName} is sponsoring ${p.eventTitle}`,
    preview: "Your sponsor partnership is confirmed.",
    heading: (p) => `Thank you for sponsoring ${p.eventTitle}`,
    body: (p) => [
      `Your organization ${p.organizationName} is officially a partner of ${p.eventTitle}. From the sponsor portal you can customise your booth, manage your leads and view live statistics.`,
    ],
    ctaLabel: "Open sponsor portal",
    infoRowLabels: {
      event: "Event",
      date: "Date",
    },
  },
  wo: {
    subject: (p) => `${p.organizationName} dafay sponsor ${p.eventTitle}`,
    preview: "Sa partenariat sponsor dafa dëgër.",
    heading: (p) => `Jërëjëf ci sa sponsor ci ${p.eventTitle}`,
    body: (p) => [
      `Sa organisation ${p.organizationName} dafa partenaire officiel ci ${p.eventTitle}. Ci espace sponsor bi mën nga personnalise sa stand, toppatoo sa leads yi te gis statistiques yi ci saa si.`,
    ],
    ctaLabel: "Dugg espace sponsor bi",
    infoRowLabels: {
      event: "Événement",
      date: "Bés",
    },
  },
};

export function buildSponsorAddedEmail(params: SponsorAddedParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.sponsorContactName,
    subject: m.subject(params),
    preview: m.preview,
    heading: m.heading(params),
    tone: "success",
    bodyParagraphs: m.body(params),
    infoRows: [
      { label: m.infoRowLabels.event, value: params.eventTitle },
      { label: m.infoRowLabels.date, value: params.eventDate },
    ],
    primaryCta: {
      label: m.ctaLabel,
      url: params.portalUrl,
    },
  });
}
