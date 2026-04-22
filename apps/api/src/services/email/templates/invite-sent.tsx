import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import { buildNotificationTemplate, pickMessages } from "../components/NotificationTemplate";

// Phase 2 notification — outbound invite email. The invitee may not have a
// Teranga account yet, so the copy stays friendly and descriptive. Role
// copy varies (co-organizer / speaker / sponsor / staff) and event-scoped
// invites surface the event title, while org-scoped invites surface the
// organization only. Neutral tone with a muted expiry notice.

export type InviteRole = "co_organizer" | "speaker" | "sponsor" | "staff";

export interface InviteSentParams {
  participantName?: string;
  inviterName: string;
  organizationName: string;
  role: InviteRole;
  /** Empty for organization-scoped invites (co_organizer); set for event-scoped invites. */
  eventTitle?: string;
  acceptUrl: string;
  /** Pre-formatted expiry, e.g. "29 avril 2026 à 18h00". */
  expiresAt: string;
  locale?: Locale;
}

interface InviteSentMessages {
  subject: (params: InviteSentParams) => string;
  preview: string;
  heading: string;
  /** Role-specific opening line (paragraph 1). */
  introByRole: (params: InviteSentParams) => string;
  /** Shared paragraph 2. */
  cta: string;
  ctaLabel: string;
  noticeText: (params: InviteSentParams) => string;
  roleLabel: Record<InviteRole, string>;
  infoRowLabels: {
    role: string;
    event: string;
    organization: string;
    expires: string;
  };
}

const MESSAGES: Record<Locale, InviteSentMessages> = {
  fr: {
    subject: (p) => `${p.inviterName} vous invite à rejoindre ${p.organizationName} sur Teranga`,
    preview: "Vous avez reçu une invitation sur Teranga.",
    heading: "Vous avez une invitation",
    introByRole: (p) => {
      switch (p.role) {
        case "co_organizer":
          return `${p.inviterName} vous invite à rejoindre Teranga en tant que co-organisateur de ${p.organizationName}.`;
        case "speaker":
          return `${p.inviterName} vous invite à rejoindre Teranga en tant qu'intervenant sur ${p.eventTitle ?? ""}.`;
        case "sponsor":
          return `${p.inviterName} vous invite à rejoindre Teranga en tant que sponsor sur ${p.eventTitle ?? ""}.`;
        case "staff":
          return `${p.inviterName} vous invite à rejoindre Teranga en tant que staff pour ${p.eventTitle ?? ""}.`;
      }
    },
    cta: "Cliquez ci-dessous pour accepter l'invitation et créer votre compte.",
    ctaLabel: "Accepter l'invitation",
    noticeText: (p) =>
      `Cette invitation expire le ${p.expiresAt}. Si vous n'êtes pas le destinataire, ignorez ce message.`,
    roleLabel: {
      co_organizer: "Co-organisateur",
      speaker: "Intervenant",
      sponsor: "Sponsor",
      staff: "Staff",
    },
    infoRowLabels: {
      role: "Rôle",
      event: "Événement",
      organization: "Organisation",
      expires: "Expire le",
    },
  },
  en: {
    subject: (p) => `${p.inviterName} invited you to join ${p.organizationName} on Teranga`,
    preview: "You've received an invitation on Teranga.",
    heading: "You have an invitation",
    introByRole: (p) => {
      switch (p.role) {
        case "co_organizer":
          return `${p.inviterName} invited you to join Teranga as a co-organizer of ${p.organizationName}.`;
        case "speaker":
          return `${p.inviterName} invited you to join Teranga as a speaker at ${p.eventTitle ?? ""}.`;
        case "sponsor":
          return `${p.inviterName} invited you to join Teranga as a sponsor at ${p.eventTitle ?? ""}.`;
        case "staff":
          return `${p.inviterName} invited you to join Teranga as staff for ${p.eventTitle ?? ""}.`;
      }
    },
    cta: "Tap the button below to accept the invitation and create your account.",
    ctaLabel: "Accept invitation",
    noticeText: (p) =>
      `This invitation expires on ${p.expiresAt}. If you weren't expecting it, please ignore this message.`,
    roleLabel: {
      co_organizer: "Co-organizer",
      speaker: "Speaker",
      sponsor: "Sponsor",
      staff: "Staff",
    },
    infoRowLabels: {
      role: "Role",
      event: "Event",
      organization: "Organization",
      expires: "Expires on",
    },
  },
  wo: {
    subject: (p) => `${p.inviterName} woote na la ci ${p.organizationName} ci Teranga`,
    preview: "Jot nga benn invitation ci Teranga.",
    heading: "Am nga benn invitation",
    introByRole: (p) => {
      switch (p.role) {
        case "co_organizer":
          return `${p.inviterName} woote na la ngir bokk ci Teranga ni co-organisateur ci ${p.organizationName}.`;
        case "speaker":
          return `${p.inviterName} woote na la ngir bokk ci Teranga ni intervenant ci ${p.eventTitle ?? ""}.`;
        case "sponsor":
          return `${p.inviterName} woote na la ngir bokk ci Teranga ni sponsor ci ${p.eventTitle ?? ""}.`;
        case "staff":
          return `${p.inviterName} woote na la ngir bokk ci Teranga ni staff ngir ${p.eventTitle ?? ""}.`;
      }
    },
    cta: "Bësal bouton bi ci suuf ngir nangu invitation bi te sos sa compte.",
    ctaLabel: "Nangu invitation bi",
    noticeText: (p) =>
      `Invitation bii dafay jog ci ${p.expiresAt}. Soo dul ki ñu woote, bàyyil message bii.`,
    roleLabel: {
      co_organizer: "Co-organisateur",
      speaker: "Intervenant",
      sponsor: "Sponsor",
      staff: "Staff",
    },
    infoRowLabels: {
      role: "Rôle",
      event: "Événement",
      organization: "Organisation",
      expires: "Dafay jog",
    },
  },
};

export function buildInviteSentEmail(params: InviteSentParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows = [{ label: m.infoRowLabels.role, value: m.roleLabel[params.role] }];
  if (params.role === "co_organizer") {
    infoRows.push({ label: m.infoRowLabels.organization, value: params.organizationName });
  } else if (params.eventTitle) {
    infoRows.push({ label: m.infoRowLabels.event, value: params.eventTitle });
  }
  infoRows.push({ label: m.infoRowLabels.expires, value: params.expiresAt });

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.participantName,
    subject: m.subject(params),
    preview: m.preview,
    heading: m.heading,
    tone: "neutral",
    bodyParagraphs: [m.introByRole(params), m.cta],
    infoRows,
    primaryCta: {
      label: m.ctaLabel,
      url: params.acceptUrl,
    },
    notice: m.noticeText(params),
  });
}
