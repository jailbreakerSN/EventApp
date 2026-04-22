import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — cancellation confirmation. Single template with a
// `cancelledBy` variant so the same email is used whether the participant
// cancelled themselves or the organizer cancelled on their behalf. When
// the registration was paid, a refund line is surfaced both in the body
// paragraph and as a dedicated info row.

export interface RegistrationCancelledParams {
  participantName?: string;
  eventTitle: string;
  /** Pre-formatted event date, e.g. "29 avril 2026". */
  eventDate: string;
  cancelledBy: "self" | "organizer";
  /** Pre-formatted refund amount, e.g. "15 000 FCFA". Omitted for free registrations. */
  refundAmount?: string;
  /** URL to the event listing page. */
  eventUrl: string;
  locale?: Locale;
}

interface RegistrationCancelledMessages {
  subject: (params: RegistrationCancelledParams) => string;
  preview: string;
  heading: (cancelledBy: "self" | "organizer") => string;
  body: (params: RegistrationCancelledParams) => string[];
  ctaLabel: string;
  infoRowLabels: {
    event: string;
    date: string;
    refund: string;
  };
}

const MESSAGES: Record<Locale, RegistrationCancelledMessages> = {
  fr: {
    subject: (p) => `Inscription annulée — ${p.eventTitle}`,
    preview: "Votre inscription a été annulée.",
    heading: (cancelledBy) =>
      cancelledBy === "self"
        ? "Votre inscription a été annulée"
        : "L'organisateur a annulé votre inscription",
    body: (p) => {
      const firstLine =
        p.cancelledBy === "self"
          ? `Votre inscription à ${p.eventTitle} le ${p.eventDate} a bien été annulée.`
          : `L'organisateur a annulé votre inscription à ${p.eventTitle} le ${p.eventDate}.`;
      const paragraphs = [firstLine];
      if (p.refundAmount) {
        paragraphs.push(
          p.cancelledBy === "self"
            ? `Un remboursement de ${p.refundAmount} sera traité dans les 5 jours ouvrés.`
            : `Un remboursement de ${p.refundAmount} vous sera versé dans les 5 jours ouvrés.`,
        );
      }
      return paragraphs;
    },
    ctaLabel: "Parcourir d'autres événements",
    infoRowLabels: {
      event: "Événement",
      date: "Date",
      refund: "Remboursement",
    },
  },
  en: {
    subject: (p) => `Registration cancelled — ${p.eventTitle}`,
    preview: "Your registration has been cancelled.",
    heading: (cancelledBy) =>
      cancelledBy === "self"
        ? "Your registration has been cancelled"
        : "The organizer cancelled your registration",
    body: (p) => {
      const firstLine =
        p.cancelledBy === "self"
          ? `Your registration for ${p.eventTitle} on ${p.eventDate} has been cancelled.`
          : `The organizer cancelled your registration for ${p.eventTitle} on ${p.eventDate}.`;
      const paragraphs = [firstLine];
      if (p.refundAmount) {
        paragraphs.push(
          p.cancelledBy === "self"
            ? `A refund of ${p.refundAmount} will be processed within 5 business days.`
            : `A refund of ${p.refundAmount} will be sent to you within 5 business days.`,
        );
      }
      return paragraphs;
    },
    ctaLabel: "Browse other events",
    infoRowLabels: {
      event: "Event",
      date: "Date",
      refund: "Refund",
    },
  },
  wo: {
    subject: (p) => `Inscription neenaw na — ${p.eventTitle}`,
    preview: "Sa inscription neenaw nañu ko.",
    heading: (cancelledBy) =>
      cancelledBy === "self"
        ? "Sa inscription neenaw na"
        : "Organisateur bi neenaw na sa inscription",
    body: (p) => {
      const firstLine =
        p.cancelledBy === "self"
          ? `Sa inscription ci ${p.eventTitle} ${p.eventDate} neenaw nañu ko.`
          : `Organisateur bi neenaw na sa inscription ci ${p.eventTitle} ${p.eventDate}.`;
      const paragraphs = [firstLine];
      if (p.refundAmount) {
        paragraphs.push(
          `Xaalis bu ñu delloo ${p.refundAmount} dinañu ko delloosi ci 5 fan bu liggéey.`,
        );
      }
      return paragraphs;
    },
    ctaLabel: "Gis yeneen événement",
    infoRowLabels: {
      event: "Événement",
      date: "Bés",
      refund: "Delloo xaalis",
    },
  },
};

export function buildRegistrationCancelledEmail(
  params: RegistrationCancelledParams,
): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows = [
    { label: m.infoRowLabels.event, value: params.eventTitle },
    { label: m.infoRowLabels.date, value: params.eventDate },
  ];
  if (params.refundAmount) {
    infoRows.push({ label: m.infoRowLabels.refund, value: params.refundAmount });
  }

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.participantName,
    subject: m.subject(params),
    preview: m.preview,
    heading: m.heading(params.cancelledBy),
    tone: "cancelled",
    bodyParagraphs: m.body(params),
    infoRows,
    primaryCta: {
      label: m.ctaLabel,
      url: params.eventUrl,
    },
  });
}
