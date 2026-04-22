import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — email address change alert. CRITICAL: this email
// is sent to the OLD address, which is the only place we can still reach
// the user if the change was malicious. Error tone, urgent CTA to support.
// A parallel confirmation email may be sent to the NEW address separately;
// that flow is outside the scope of this template.

export interface EmailChangedParams {
  name: string;
  oldEmail: string;
  newEmail: string;
  /** Pre-formatted with timezone, e.g. "22 avril 2026 à 14h05 (Africa/Dakar)". */
  changedAt: string;
  supportUrl: string;
  locale?: Locale;
}

interface EmailChangedMessages {
  subject: string;
  preview: string;
  heading: string;
  body: (params: EmailChangedParams) => string[];
  ctaLabel: string;
  infoRowLabels: {
    changedAt: string;
    oldEmail: string;
    newEmail: string;
  };
}

const MESSAGES: Record<Locale, EmailChangedMessages> = {
  fr: {
    subject: "Votre adresse e-mail a été modifiée",
    preview: "L'adresse e-mail de votre compte Teranga a changé.",
    heading: "Votre adresse e-mail a changé",
    body: (p) => [
      `L'adresse e-mail de votre compte Teranga a été modifiée le ${p.changedAt}. L'ancienne adresse était ${p.oldEmail}, la nouvelle est ${p.newEmail}.`,
      "Ce message est envoyé à votre ancienne adresse à des fins de sécurité. Si vous n'êtes pas à l'origine de ce changement, contactez-nous immédiatement — votre compte pourrait être compromis.",
    ],
    ctaLabel: "Contacter le support d'urgence",
    infoRowLabels: {
      changedAt: "Date",
      oldEmail: "Ancien e-mail",
      newEmail: "Nouvel e-mail",
    },
  },
  en: {
    subject: "Your email address was changed",
    preview: "The email address on your Teranga account has changed.",
    heading: "Your email address changed",
    body: (p) => [
      `The email address on your Teranga account was changed on ${p.changedAt}. The previous address was ${p.oldEmail}; the new address is ${p.newEmail}.`,
      "This message is being sent to your previous address for security reasons. If you did not make this change, contact us immediately — your account may be compromised.",
    ],
    ctaLabel: "Contact emergency support",
    infoRowLabels: {
      changedAt: "Date",
      oldEmail: "Previous email",
      newEmail: "New email",
    },
  },
  wo: {
    subject: "Sa adresse imayil soppi nañu ko",
    preview: "Adresse imayil u sa compte Teranga soppi.",
    heading: "Sa adresse imayil soppi na",
    body: (p) => [
      `Adresse imayil u sa compte Teranga soppi nañu ko ci ${p.changedAt}. Adresse bu jëkk mooy ${p.oldEmail}, bu bees mooy ${p.newEmail}.`,
      "Message bii yónnee nañu ko ci sa adresse bu jëkk ngir sécurité. Soo duloo ki def changement bii, jokkool ak nu léegi — sa compte mën na nekk ci jafe-jafe.",
    ],
    ctaLabel: "Jokkool ak support urgent",
    infoRowLabels: {
      changedAt: "Bés",
      oldEmail: "Imayil bu jëkk",
      newEmail: "Imayil bu bees",
    },
  },
};

export function buildEmailChangedEmail(params: EmailChangedParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.name,
    subject: m.subject,
    preview: m.preview,
    heading: m.heading,
    tone: "error",
    bodyParagraphs: m.body(params),
    infoRows: [
      { label: m.infoRowLabels.changedAt, value: params.changedAt },
      { label: m.infoRowLabels.oldEmail, value: params.oldEmail },
      { label: m.infoRowLabels.newEmail, value: params.newEmail },
    ],
    primaryCta: {
      label: m.ctaLabel,
      url: params.supportUrl,
    },
  });
}
