import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2.3 — post-event feedback request. Sent to every participant who
// actually checked in (status === "checked_in") 2 hours after the event
// ends. Purely optional (userOptOutAllowed=true) — participants who don't
// care about the survey should not get pinged. The in-app channel is also
// supported so the bell icon nudges users who don't open the email.

export interface EventFeedbackRequestedParams {
  participantName?: string;
  eventTitle: string;
  /** Pre-formatted event end date, e.g. "22 avril 2026 à 18h00". */
  eventEndedAt: string;
  /** Absolute URL to the feedback/survey form. */
  feedbackUrl: string;
  /** Optional pre-formatted deadline, e.g. "29 avril 2026". */
  feedbackDeadline?: string;
  locale?: Locale;
  unsubscribeNote?: string;
}

interface EventFeedbackRequestedMessages {
  subject: (params: EventFeedbackRequestedParams) => string;
  preview: (params: EventFeedbackRequestedParams) => string;
  heading: string;
  body: (params: EventFeedbackRequestedParams) => string[];
  ctaLabel: string;
  noticeText?: (params: EventFeedbackRequestedParams) => string;
  infoRowLabels: {
    event: string;
    endedAt: string;
    deadline: string;
  };
}

const MESSAGES: Record<Locale, EventFeedbackRequestedMessages> = {
  fr: {
    subject: (p) => `Votre avis sur ${p.eventTitle}`,
    preview: (p) => `Partagez votre retour sur ${p.eventTitle} en 2 minutes.`,
    heading: "Comment s'est passé l'événement ?",
    body: (p) => [
      `Merci d'avoir participé à ${p.eventTitle}. Votre retour nous aide — et aide l'organisateur — à améliorer les prochaines éditions.`,
      `Le formulaire prend moins de 2 minutes.`,
    ],
    ctaLabel: "Donner mon avis",
    noticeText: (p) =>
      p.feedbackDeadline ? `Merci de répondre avant le ${p.feedbackDeadline}.` : undefined!,
    infoRowLabels: {
      event: "Événement",
      endedAt: "Terminé le",
      deadline: "À remplir avant",
    },
  },
  en: {
    subject: (p) => `Your feedback on ${p.eventTitle}`,
    preview: (p) => `Share your thoughts on ${p.eventTitle} in 2 minutes.`,
    heading: "How was the event?",
    body: (p) => [
      `Thanks for attending ${p.eventTitle}. Your feedback helps us — and the organiser — make the next editions even better.`,
      `The form takes less than 2 minutes.`,
    ],
    ctaLabel: "Share my feedback",
    noticeText: (p) =>
      p.feedbackDeadline ? `Please reply before ${p.feedbackDeadline}.` : undefined!,
    infoRowLabels: {
      event: "Event",
      endedAt: "Ended on",
      deadline: "Deadline",
    },
  },
  wo: {
    subject: (p) => `Sa xalaat ci ${p.eventTitle}`,
    preview: (p) => `Joxel sa xalaat ci ${p.eventTitle} ci 2 simili.`,
    heading: "Naka la événement bi tàbbi ?",
    body: (p) => [
      `Jërejëf ci sa bokk ci ${p.eventTitle}. Sa xalaat dina nu jàppale — ak organisateur bi — ngir yokk prochain édition yi.`,
      `Formulaire bi, du yàgg ak 2 simili.`,
    ],
    ctaLabel: "Joxe sa xalaat",
    noticeText: (p) =>
      p.feedbackDeadline ? `Tontul balaa ${p.feedbackDeadline}.` : undefined!,
    infoRowLabels: {
      event: "Événement",
      endedAt: "Jeex na ci",
      deadline: "Jeexit bi",
    },
  },
};

export function buildEventFeedbackRequestedEmail(
  params: EventFeedbackRequestedParams,
): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows: { label: string; value: string }[] = [
    { label: m.infoRowLabels.event, value: params.eventTitle },
    { label: m.infoRowLabels.endedAt, value: params.eventEndedAt },
  ];
  if (params.feedbackDeadline) {
    infoRows.push({ label: m.infoRowLabels.deadline, value: params.feedbackDeadline });
  }

  const notice = m.noticeText ? m.noticeText(params) : undefined;

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.participantName,
    subject: m.subject(params),
    preview: m.preview(params),
    heading: m.heading,
    tone: "neutral",
    bodyParagraphs: m.body(params),
    infoRows,
    notice: notice || undefined,
    primaryCta: {
      label: m.ctaLabel,
      url: params.feedbackUrl,
    },
    unsubscribeNote: params.unsubscribeNote,
  });
}
