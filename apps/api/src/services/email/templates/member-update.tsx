import { type Locale } from "../i18n";
import { type RenderedEmail } from "../render";
import {
  buildNotificationTemplate,
  pickMessages,
  type NotificationTone,
} from "../components/NotificationTemplate";

// Phase 2 notification — organization membership change. Single template
// covers three kinds: added / removed / role_changed. The variant chooses the
// tone, subject, heading, and body copy, and also toggles the CTA and the
// role info rows. We keep the copy short and actionable — members rarely
// read past the first paragraph, so the important signal is the heading
// tone colour.

export type MemberUpdateKind = "added" | "removed" | "role_changed";

export interface MemberUpdateParams {
  memberName?: string;
  organizationName: string;
  kind: MemberUpdateKind;
  /** Required when kind === "role_changed"; optional when kind === "added". */
  newRole?: string;
  /** Required when kind === "role_changed". */
  oldRole?: string;
  /** Back-office organization dashboard URL. */
  orgUrl: string;
  locale?: Locale;
}

interface MemberUpdateMessages {
  subject: (params: MemberUpdateParams) => string;
  preview: (params: MemberUpdateParams) => string;
  heading: (params: MemberUpdateParams) => string;
  body: (params: MemberUpdateParams) => string[];
  ctaLabel: string;
  infoRowLabels: {
    organization: string;
    role: string;
    previousRole: string;
  };
}

const MESSAGES: Record<Locale, MemberUpdateMessages> = {
  fr: {
    subject: (p) => {
      switch (p.kind) {
        case "added":
          return `Bienvenue dans ${p.organizationName}`;
        case "removed":
          return `Vous avez été retiré de ${p.organizationName}`;
        case "role_changed":
          return `Votre rôle a changé dans ${p.organizationName}`;
      }
    },
    preview: (p) => {
      switch (p.kind) {
        case "added":
          return `Vous rejoignez ${p.organizationName} sur Teranga.`;
        case "removed":
          return `Votre accès à ${p.organizationName} a été révoqué.`;
        case "role_changed":
          return `Votre rôle dans ${p.organizationName} a été mis à jour.`;
      }
    },
    heading: (p) => {
      switch (p.kind) {
        case "added":
          return `Bienvenue dans ${p.organizationName}`;
        case "removed":
          return "Accès révoqué";
        case "role_changed":
          return "Votre rôle a été mis à jour";
      }
    },
    body: (p) => {
      switch (p.kind) {
        case "added":
          return [
            `Vous faites maintenant partie de l'équipe ${p.organizationName}. Vous pouvez accéder au tableau de bord depuis le lien ci-dessous.`,
          ];
        case "removed":
          return [
            `Votre accès à ${p.organizationName} a été révoqué. Si vous pensez qu'il s'agit d'une erreur, contactez l'administrateur de l'organisation.`,
          ];
        case "role_changed":
          return [
            `Votre rôle dans ${p.organizationName} est passé de ${p.oldRole ?? ""} à ${p.newRole ?? ""}. Vos permissions ont été mises à jour en conséquence.`,
          ];
      }
    },
    ctaLabel: "Accéder au tableau de bord",
    infoRowLabels: {
      organization: "Organisation",
      role: "Rôle",
      previousRole: "Ancien rôle",
    },
  },
  en: {
    subject: (p) => {
      switch (p.kind) {
        case "added":
          return `Welcome to ${p.organizationName}`;
        case "removed":
          return `You've been removed from ${p.organizationName}`;
        case "role_changed":
          return `Your role changed in ${p.organizationName}`;
      }
    },
    preview: (p) => {
      switch (p.kind) {
        case "added":
          return `You're joining ${p.organizationName} on Teranga.`;
        case "removed":
          return `Your access to ${p.organizationName} has been revoked.`;
        case "role_changed":
          return `Your role in ${p.organizationName} has been updated.`;
      }
    },
    heading: (p) => {
      switch (p.kind) {
        case "added":
          return `Welcome to ${p.organizationName}`;
        case "removed":
          return "Access revoked";
        case "role_changed":
          return "Your role was updated";
      }
    },
    body: (p) => {
      switch (p.kind) {
        case "added":
          return [
            `You're now part of the ${p.organizationName} team. You can access the dashboard from the link below.`,
          ];
        case "removed":
          return [
            `Your access to ${p.organizationName} has been revoked. If you think this is a mistake, contact the organization administrator.`,
          ];
        case "role_changed":
          return [
            `Your role in ${p.organizationName} changed from ${p.oldRole ?? ""} to ${p.newRole ?? ""}. Your permissions have been updated accordingly.`,
          ];
      }
    },
    ctaLabel: "Go to dashboard",
    infoRowLabels: {
      organization: "Organization",
      role: "Role",
      previousRole: "Previous role",
    },
  },
  wo: {
    subject: (p) => {
      switch (p.kind) {
        case "added":
          return `Dalal jàmm ci ${p.organizationName}`;
        case "removed":
          return `Jële nañu la ci ${p.organizationName}`;
        case "role_changed":
          return `Sa rôle dafa soppi ci ${p.organizationName}`;
      }
    },
    preview: (p) => {
      switch (p.kind) {
        case "added":
          return `Bokk nga ci ${p.organizationName} ci Teranga.`;
        case "removed":
          return `Sa accès ci ${p.organizationName} neenaw na.`;
        case "role_changed":
          return `Sa rôle ci ${p.organizationName} soppi nañu ko.`;
      }
    },
    heading: (p) => {
      switch (p.kind) {
        case "added":
          return `Dalal jàmm ci ${p.organizationName}`;
        case "removed":
          return "Accès neenaw na";
        case "role_changed":
          return "Sa rôle soppi nañu ko";
      }
    },
    body: (p) => {
      switch (p.kind) {
        case "added":
          return [
            `Léegi bokk nga ci équipe ${p.organizationName}. Mën nga dugg tableau de bord bi ak lien bi ci suuf.`,
          ];
        case "removed":
          return [
            `Sa accès ci ${p.organizationName} neenaw nañu ko. Soo xalaat ni njuumte la, jokkool ak administrateur u organisation bi.`,
          ];
        case "role_changed":
          return [
            `Sa rôle ci ${p.organizationName} jóge na ci ${p.oldRole ?? ""} demal ci ${p.newRole ?? ""}. Sa permissions yi dañu leen soppi.`,
          ];
      }
    },
    ctaLabel: "Dugg tableau de bord bi",
    infoRowLabels: {
      organization: "Organisation",
      role: "Rôle",
      previousRole: "Rôle bu jëkk",
    },
  },
};

function toneFor(kind: MemberUpdateKind): NotificationTone {
  switch (kind) {
    case "added":
      return "success";
    case "removed":
      return "cancelled";
    case "role_changed":
      return "neutral";
  }
}

export function buildMemberUpdateEmail(params: MemberUpdateParams): Promise<RenderedEmail> {
  const m = pickMessages(params.locale, MESSAGES);

  const infoRows: { label: string; value: string }[] = [
    { label: m.infoRowLabels.organization, value: params.organizationName },
  ];
  if ((params.kind === "added" || params.kind === "role_changed") && params.newRole) {
    infoRows.push({ label: m.infoRowLabels.role, value: params.newRole });
  }
  if (params.kind === "role_changed" && params.oldRole) {
    infoRows.push({ label: m.infoRowLabels.previousRole, value: params.oldRole });
  }

  const primaryCta =
    params.kind === "added" || params.kind === "role_changed"
      ? { label: m.ctaLabel, url: params.orgUrl }
      : undefined;

  return buildNotificationTemplate({
    locale: params.locale,
    recipientName: params.memberName,
    subject: m.subject(params),
    preview: m.preview(params),
    heading: m.heading(params),
    tone: toneFor(params.kind),
    bodyParagraphs: m.body(params),
    infoRows,
    primaryCta,
  });
}
