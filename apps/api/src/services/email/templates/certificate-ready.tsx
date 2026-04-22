import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2.3 — certificate of attendance ready. Fires when the organizer
// clicks "Issue certificates" in the back-office. The dispatcher fans out
// one email per eligible participant with a signed download URL. Success
// tone — celebratory nudge, not a chore.

export interface CertificateReadyParams {
  participantName?: string;
  eventTitle: string;
  /** Pre-formatted event end date, e.g. "22 avril 2026". */
  eventDate: string;
  /** Absolute URL to the certificate PDF (signed URL, generally expires). */
  certificateUrl: string;
  /** Optional — pre-formatted URL validity hint, e.g. "30 jours". */
  validityHint?: string;
  locale?: Locale;
  unsubscribeNote?: string;
}

interface CertificateReadyMessages {
  subject: (params: CertificateReadyParams) => string;
  preview: (params: CertificateReadyParams) => string;
  heading: string;
  body: (params: CertificateReadyParams) => string[];
  ctaLabel: string;
  noticeText?: (params: CertificateReadyParams) => string;
  infoRowLabels: {
    event: string;
    date: string;
    validity: string;
  };
}

const MESSAGES: Record<Locale, CertificateReadyMessages> = {
  fr: {
    subject: (p) => `Votre certificat de participation — ${p.eventTitle}`,
    preview: (p) => `Téléchargez votre certificat de participation à ${p.eventTitle}.`,
    heading: "Votre certificat est prêt",
    body: (p) => [
      `Félicitations ! Votre certificat de participation à ${p.eventTitle} est désormais disponible au téléchargement.`,
      `Conservez-le précieusement — il peut servir à justifier votre présence auprès de votre employeur ou de votre école.`,
    ],
    ctaLabel: "Télécharger mon certificat",
    noticeText: (p) =>
      p.validityHint ? `Le lien de téléchargement est valide pendant ${p.validityHint}.` : undefined!,
    infoRowLabels: {
      event: "Événement",
      date: "Date",
      validity: "Validité du lien",
    },
  },
  en: {
    subject: (p) => `Your certificate of attendance — ${p.eventTitle}`,
    preview: (p) => `Download your certificate of attendance for ${p.eventTitle}.`,
    heading: "Your certificate is ready",
    body: (p) => [
      `Congratulations! Your certificate of attendance for ${p.eventTitle} is now available to download.`,
      `Keep it safe — you can use it to prove attendance to your employer or school.`,
    ],
    ctaLabel: "Download certificate",
    noticeText: (p) =>
      p.validityHint ? `The download link is valid for ${p.validityHint}.` : undefined!,
    infoRowLabels: {
      event: "Event",
      date: "Date",
      validity: "Link validity",
    },
  },
  wo: {
    subject: (p) => `Sa certificat participation — ${p.eventTitle}`,
    preview: (p) => `Jél sa certificat participation ci ${p.eventTitle}.`,
    heading: "Sa certificat wóor na",
    body: (p) => [
      `Dëkk bu baax ! Sa certificat participation ci ${p.eventTitle} man nañu ko download léegi.`,
      `Dénk ko bu baax — mën nga ko jëfandikoo ngir wone sa bokk ci employeur bi walla ekool bi.`,
    ],
    ctaLabel: "Download certificat bi",
    noticeText: (p) =>
      p.validityHint ? `Lien download bi, valide la ci diggante ${p.validityHint}.` : undefined!,
    infoRowLabels: {
      event: "Événement",
      date: "Bés",
      validity: "Validité lien bi",
    },
  },
};

export function buildCertificateReadyEmail(
  params: CertificateReadyParams,
): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows: { label: string; value: string }[] = [
    { label: m.infoRowLabels.event, value: params.eventTitle },
    { label: m.infoRowLabels.date, value: params.eventDate },
  ];
  if (params.validityHint) {
    infoRows.push({ label: m.infoRowLabels.validity, value: params.validityHint });
  }

  const notice = m.noticeText ? m.noticeText(params) : undefined;

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.participantName,
    subject: m.subject(params),
    preview: m.preview(params),
    heading: m.heading,
    tone: "success",
    bodyParagraphs: m.body(params),
    infoRows,
    notice: notice || undefined,
    primaryCta: {
      label: m.ctaLabel,
      url: params.certificateUrl,
    },
    unsubscribeNote: params.unsubscribeNote,
  });
}
