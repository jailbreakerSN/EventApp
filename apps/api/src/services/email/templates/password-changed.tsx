import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — post-change password alert. Sent AFTER a
// successful password change (distinct from password-reset.tsx which drives
// the reset flow itself). Warning tone because the change is legitimate in
// the common case, but the inner notice uses error tone to make the
// "wasn't you?" warning pop for anyone scanning the email on mobile.

export interface PasswordChangedParams {
  name: string;
  /** Pre-formatted with timezone, e.g. "22 avril 2026 à 14h05 (Africa/Dakar)". */
  changedAt: string;
  ipAddress?: string;
  city?: string;
  supportUrl: string;
  locale?: Locale;
}

interface PasswordChangedMessages {
  subject: string;
  preview: string;
  heading: string;
  body: (params: PasswordChangedParams) => string[];
  ctaLabel: string;
  noticeText: string;
  infoRowLabels: {
    changedAt: string;
    ipAddress: string;
    location: string;
  };
}

const MESSAGES: Record<Locale, PasswordChangedMessages> = {
  fr: {
    subject: "Votre mot de passe a été modifié",
    preview: "Votre mot de passe Teranga vient d'être modifié.",
    heading: "Mot de passe modifié",
    body: (p) => {
      const extras: string[] = [];
      if (p.ipAddress) extras.push(` depuis l'adresse IP ${p.ipAddress}`);
      if (p.city) extras.push(` (${p.city})`);
      return [
        `Le mot de passe de votre compte Teranga a été modifié le ${p.changedAt}${extras.join("")}.`,
        "Si vous n'êtes PAS à l'origine de ce changement, réinitialisez immédiatement votre mot de passe et contactez-nous.",
      ];
    },
    ctaLabel: "Signaler une activité suspecte",
    noticeText: "Ce n'est pas vous ? Agissez maintenant.",
    infoRowLabels: {
      changedAt: "Date",
      ipAddress: "Adresse IP",
      location: "Localisation",
    },
  },
  en: {
    subject: "Your password was changed",
    preview: "Your Teranga password was just changed.",
    heading: "Password changed",
    body: (p) => {
      const extras: string[] = [];
      if (p.ipAddress) extras.push(` from IP address ${p.ipAddress}`);
      if (p.city) extras.push(` (${p.city})`);
      return [
        `Your Teranga account password was changed on ${p.changedAt}${extras.join("")}.`,
        "If you did NOT make this change, reset your password immediately and contact us.",
      ];
    },
    ctaLabel: "Report suspicious activity",
    noticeText: "Wasn't you? Act now.",
    infoRowLabels: {
      changedAt: "Date",
      ipAddress: "IP address",
      location: "Location",
    },
  },
  wo: {
    subject: "Sa mot de passe soppi nañu ko",
    preview: "Sa mot de passe Teranga soppi nañu ko léegi.",
    heading: "Mot de passe soppi",
    body: (p) => {
      const extras: string[] = [];
      if (p.ipAddress) extras.push(` ak adresse IP ${p.ipAddress}`);
      if (p.city) extras.push(` (${p.city})`);
      return [
        `Mot de passe u sa compte Teranga soppi nañu ko ci ${p.changedAt}${extras.join("")}.`,
        "Soo duloo ki def changement bii, reset sa mot de passe léegi te jokkool ak nu.",
      ];
    },
    ctaLabel: "Signaler activité suspecte",
    noticeText: "Du yaw? Jëfal léegi.",
    infoRowLabels: {
      changedAt: "Bés",
      ipAddress: "Adresse IP",
      location: "Béreb",
    },
  },
};

export function buildPasswordChangedEmail(params: PasswordChangedParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows: { label: string; value: string }[] = [
    { label: m.infoRowLabels.changedAt, value: params.changedAt },
  ];
  if (params.ipAddress) {
    infoRows.push({ label: m.infoRowLabels.ipAddress, value: params.ipAddress });
  }
  if (params.city) {
    infoRows.push({ label: m.infoRowLabels.location, value: params.city });
  }

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.name,
    subject: m.subject,
    preview: m.preview,
    heading: m.heading,
    // Outer frame is warning; the notice box below uses the error accent
    // by virtue of the tone prop — we flip the WHOLE template to warning
    // because the shell maps tone → notice style. To get the "error notice
    // inside warning shell" look requested in the spec, we keep the shell
    // on warning (heading accent) and rely on the notice copy tone for the
    // loudest signal. This is the closest fit without refactoring
    // NotificationTemplate to accept a separate noticeTone prop.
    tone: "warning",
    bodyParagraphs: m.body(params),
    infoRows,
    notice: m.noticeText,
    primaryCta: {
      label: m.ctaLabel,
      url: params.supportUrl,
    },
  });
}
