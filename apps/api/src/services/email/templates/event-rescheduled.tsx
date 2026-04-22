import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — event rescheduled. Sent to all registrants when
// the event's start/end dates change, with the old and new dates shown
// side by side. Warning tone keeps the message noticeable without looking
// like a cancellation. An optional new location is surfaced when the venue
// also moves (e.g. dates pushed to a different weekend at a different hall).

export interface EventRescheduledParams {
  participantName?: string;
  eventTitle: string;
  /** Pre-formatted previous date. */
  oldDate: string;
  /** Pre-formatted new date. */
  newDate: string;
  /** Optional new location if the venue also changed. */
  newLocation?: string;
  eventUrl: string;
  locale?: Locale;
}

interface EventRescheduledMessages {
  subject: (params: EventRescheduledParams) => string;
  preview: string;
  heading: string;
  body: (params: EventRescheduledParams) => string[];
  ctaLabel: string;
  infoRowLabels: {
    oldDate: string;
    newDate: string;
    location: string;
  };
}

const MESSAGES: Record<Locale, EventRescheduledMessages> = {
  fr: {
    subject: (p) => `Événement reprogrammé — ${p.eventTitle}`,
    preview: "L'événement a été reprogrammé — votre inscription reste valide.",
    heading: "L'événement a été reprogrammé",
    body: (p) => [
      `${p.eventTitle} a été reprogrammé. Votre inscription reste valide.`,
      "Notez la nouvelle date dans votre agenda. Si cette date ne vous convient pas, vous pouvez annuler depuis votre espace participant.",
    ],
    ctaLabel: "Voir l'événement",
    infoRowLabels: {
      oldDate: "Ancienne date",
      newDate: "Nouvelle date",
      location: "Lieu",
    },
  },
  en: {
    subject: (p) => `Event rescheduled — ${p.eventTitle}`,
    preview: "The event has been rescheduled — your registration is still valid.",
    heading: "The event has been rescheduled",
    body: (p) => [
      `${p.eventTitle} has been rescheduled. Your registration is still valid.`,
      "Update your calendar with the new date. If the new date doesn't work for you, you can cancel from your participant dashboard.",
    ],
    ctaLabel: "View event",
    infoRowLabels: {
      oldDate: "Previous date",
      newDate: "New date",
      location: "Location",
    },
  },
  wo: {
    subject: (p) => `Événement bi soppi nañu bés bi — ${p.eventTitle}`,
    preview: "Événement bi soppi nañu bés bi — sa inscription maintenu na.",
    heading: "Événement bi soppi nañu bés bi",
    body: (p) => [
      `${p.eventTitle} soppi nañu bés bi. Sa inscription maintenu na.`,
      "Bindal bés bu bees bi ci sa agenda. Su bés bu bees bi neexul la, mën nga ko annuler ci sa espace participant.",
    ],
    ctaLabel: "Gis événement bi",
    infoRowLabels: {
      oldDate: "Bés bu jëkk",
      newDate: "Bés bu bees",
      location: "Béreb",
    },
  },
};

export function buildEventRescheduledEmail(params: EventRescheduledParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows = [
    { label: m.infoRowLabels.oldDate, value: params.oldDate },
    { label: m.infoRowLabels.newDate, value: params.newDate },
  ];
  if (params.newLocation) {
    infoRows.push({ label: m.infoRowLabels.location, value: params.newLocation });
  }

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.participantName,
    subject: m.subject(params),
    preview: m.preview,
    heading: m.heading,
    tone: "warning",
    bodyParagraphs: m.body(params),
    infoRows,
    primaryCta: {
      label: m.ctaLabel,
      url: params.eventUrl,
    },
  });
}
