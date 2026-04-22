import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — waitlist promotion. Tells a waitlisted participant
// that a spot has opened up and is temporarily held for them. The hold
// window is always rendered with emphasis (info row + warning notice)
// because the user must confirm before it expires or the spot rolls to
// the next waitlist entry.

export interface WaitlistPromotedParams {
  participantName?: string;
  eventTitle: string;
  /** Pre-formatted event date, e.g. "29 avril 2026". */
  eventDate: string;
  /** URL to confirm the held spot. */
  confirmUrl: string;
  /** Pre-formatted deadline, e.g. "24 avril 2026 à 22h00". */
  holdExpiresAt: string;
  locale?: Locale;
}

interface WaitlistPromotedMessages {
  subject: (params: WaitlistPromotedParams) => string;
  preview: string;
  heading: string;
  body: (params: WaitlistPromotedParams) => string[];
  ctaLabel: string;
  noticeText: (params: WaitlistPromotedParams) => string;
  infoRowLabels: {
    event: string;
    date: string;
    holdExpires: string;
  };
}

const MESSAGES: Record<Locale, WaitlistPromotedMessages> = {
  fr: {
    subject: (p) => `Une place s'est libérée pour ${p.eventTitle}`,
    preview: "Une place vient de se libérer — confirmez avant expiration.",
    heading: "Bonne nouvelle, une place s'est libérée !",
    body: (p) => [
      `Une place vient de se libérer pour ${p.eventTitle}.`,
      `Nous avons réservé cette place pour vous. Confirmez votre inscription avant le ${p.holdExpiresAt} — après cette date elle sera proposée au prochain inscrit sur liste d'attente.`,
    ],
    ctaLabel: "Confirmer ma place",
    noticeText: (p) => `Attention, cette place expire le ${p.holdExpiresAt}.`,
    infoRowLabels: {
      event: "Événement",
      date: "Date",
      holdExpires: "Expire le",
    },
  },
  en: {
    subject: (p) => `A spot opened up for ${p.eventTitle}`,
    preview: "A spot opened up — please confirm before it expires.",
    heading: "Good news, a spot opened up!",
    body: (p) => [
      `A spot just opened up for ${p.eventTitle}.`,
      `We're holding this spot for you. Confirm your registration before ${p.holdExpiresAt} — after that it rolls to the next person on the waitlist.`,
    ],
    ctaLabel: "Confirm my spot",
    noticeText: (p) => `Heads up, this spot expires on ${p.holdExpiresAt}.`,
    infoRowLabels: {
      event: "Event",
      date: "Date",
      holdExpires: "Expires on",
    },
  },
  wo: {
    subject: (p) => `Am na benn place bu ubbeeku ngir ${p.eventTitle}`,
    preview: "Am na benn place bu ubbeeku — wéral laata mu jog.",
    heading: "Xibaar bu rafet, am na benn place bu ubbeeku !",
    body: (p) => [
      `Am na benn place bu ubbeeku ngir ${p.eventTitle}.`,
      `Dencë nu la place bii. Wéral sa inscription laata ${p.holdExpiresAt} — suba loolu mu ngi dem ci ku ci topp ci liste bi.`,
    ],
    ctaLabel: "Wéral sa place",
    noticeText: (p) => `Moytul, place bii dafay jog ${p.holdExpiresAt}.`,
    infoRowLabels: {
      event: "Événement",
      date: "Bés",
      holdExpires: "Dafay jog",
    },
  },
};

export function buildWaitlistPromotedEmail(params: WaitlistPromotedParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows = [
    { label: m.infoRowLabels.event, value: params.eventTitle },
    { label: m.infoRowLabels.date, value: params.eventDate },
    { label: m.infoRowLabels.holdExpires, value: params.holdExpiresAt },
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
    primaryCta: {
      label: m.ctaLabel,
      url: params.confirmUrl,
    },
    notice: m.noticeText(params),
  });
}
