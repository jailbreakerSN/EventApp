import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — first-time platform welcome. Triggered on
// signup once the user verifies their email (see email-verification.tsx
// for the pre-verification step). This is distinct from the existing
// newsletter welcome (welcome-newsletter.tsx); different surface, different
// audience. Success tone, drives the user into the core discovery loop.

export interface WelcomeParams {
  name: string;
  /** Base app URL — kept for future linking needs (e.g. profile completion CTA). */
  appUrl: string;
  /** Direct URL to the participant events explorer. */
  exploreEventsUrl: string;
  locale?: Locale;
}

interface WelcomeMessages {
  subject: (params: WelcomeParams) => string;
  preview: string;
  heading: string;
  body: string[];
  ctaLabel: string;
  secondaryHint: string;
}

const MESSAGES: Record<Locale, WelcomeMessages> = {
  fr: {
    subject: (p) => `Bienvenue sur Teranga, ${p.name} 👋`,
    preview: "Votre compte Teranga est prêt — découvrez les événements à venir.",
    heading: "Bienvenue sur Teranga !",
    body: [
      "Nous sommes ravis de vous compter parmi nous. Teranga est la plateforme événementielle pensée pour le Sénégal — du badge QR offline aux paiements mobile money.",
      "Commencez par explorer les événements à venir, ou complétez votre profil pour recevoir des recommandations personnalisées.",
    ],
    ctaLabel: "Explorer les événements",
    secondaryHint:
      "Besoin d'aide ? Répondez simplement à cet e-mail, nous vous répondrons sous 24h.",
  },
  en: {
    subject: (p) => `Welcome to Teranga, ${p.name} 👋`,
    preview: "Your Teranga account is ready — explore upcoming events.",
    heading: "Welcome to Teranga!",
    body: [
      "We're delighted to have you on board. Teranga is the event platform built for Senegal — from offline QR badges to mobile money payments.",
      "Start by exploring upcoming events, or complete your profile to receive personalised recommendations.",
    ],
    ctaLabel: "Explore events",
    secondaryHint: "Need help? Just reply to this email and we'll get back to you within 24 hours.",
  },
  wo: {
    subject: (p) => `Dalal jàmm ci Teranga, ${p.name} 👋`,
    preview: "Sa compte Teranga waaj na — xoolal événements yi di ñëw.",
    heading: "Dalal jàmm ci Teranga !",
    body: [
      "Kontaan nanu ci yaw. Teranga mooy plateforme événement bi ñu def ngir Senegaal — li ko jëm ci badge QR offline ba paiement mobile money.",
      "Tàmbalil xool événements yi di ñëw, walla mottalil sa profil ngir jot recommandations yu mel ni yaw.",
    ],
    ctaLabel: "Xool événements yi",
    secondaryHint: "Soo soxla ndimbal, tontul rekk ci imayil bii, dinanu la tontu ci 24 waxtu.",
  },
};

export function buildPlatformWelcomeEmail(params: WelcomeParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.name,
    subject: m.subject(params),
    preview: m.preview,
    heading: m.heading,
    tone: "success",
    bodyParagraphs: m.body,
    primaryCta: {
      label: m.ctaLabel,
      url: params.exploreEventsUrl,
    },
    secondaryHint: m.secondaryHint,
  });
}
