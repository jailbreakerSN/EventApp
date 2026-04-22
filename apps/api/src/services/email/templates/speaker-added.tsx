import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — speaker added to an event. Sent when an organizer
// adds a user (or accepted invitee) as a speaker. The CTA takes them to the
// speaker portal where they can complete their bio, manage sessions and
// download their badge. Success tone — this is a warm invitation.

export interface SpeakerAddedParams {
  speakerName: string;
  eventTitle: string;
  /** Pre-formatted date, e.g. "15 mai 2026". */
  eventDate: string;
  eventLocation: string;
  portalUrl: string;
  locale?: Locale;
}

interface SpeakerAddedMessages {
  subject: (params: SpeakerAddedParams) => string;
  preview: string;
  heading: string;
  body: (params: SpeakerAddedParams) => string[];
  ctaLabel: string;
  infoRowLabels: {
    event: string;
    date: string;
    location: string;
  };
}

const MESSAGES: Record<Locale, SpeakerAddedMessages> = {
  fr: {
    subject: (p) => `Vous êtes intervenant pour ${p.eventTitle}`,
    preview: "Vous avez été ajouté comme intervenant sur Teranga.",
    heading: "Vous êtes invité à intervenir",
    body: (p) => [
      `Vous avez été ajouté en tant qu'intervenant sur ${p.eventTitle}. Depuis votre espace intervenant vous pouvez compléter votre biographie, gérer vos sessions et accéder à votre badge.`,
    ],
    ctaLabel: "Accéder à l'espace intervenant",
    infoRowLabels: {
      event: "Événement",
      date: "Date",
      location: "Lieu",
    },
  },
  en: {
    subject: (p) => `You're a speaker at ${p.eventTitle}`,
    preview: "You've been added as a speaker on Teranga.",
    heading: "You've been invited to speak",
    body: (p) => [
      `You've been added as a speaker at ${p.eventTitle}. From your speaker portal you can complete your biography, manage your sessions and access your badge.`,
    ],
    ctaLabel: "Open speaker portal",
    infoRowLabels: {
      event: "Event",
      date: "Date",
      location: "Location",
    },
  },
  wo: {
    subject: (p) => `Intervenant nga ngir ${p.eventTitle}`,
    preview: "Yokk nañu la ni intervenant ci Teranga.",
    heading: "Woote nañu la ngir wax",
    body: (p) => [
      `Yokk nañu la ni intervenant ci ${p.eventTitle}. Ci sa espace intervenant mën nga bind sa biographie, toppatoo sa sessions yi te yéeg sa badge.`,
    ],
    ctaLabel: "Dugg espace intervenant bi",
    infoRowLabels: {
      event: "Événement",
      date: "Bés",
      location: "Béreb",
    },
  },
};

export function buildSpeakerAddedEmail(params: SpeakerAddedParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.speakerName,
    subject: m.subject(params),
    preview: m.preview,
    heading: m.heading,
    tone: "success",
    bodyParagraphs: m.body(params),
    infoRows: [
      { label: m.infoRowLabels.event, value: params.eventTitle },
      { label: m.infoRowLabels.date, value: params.eventDate },
      { label: m.infoRowLabels.location, value: params.eventLocation },
    ],
    primaryCta: {
      label: m.ctaLabel,
      url: params.portalUrl,
    },
  });
}
