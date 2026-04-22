import {
  NOTIFICATION_CATALOG_BY_KEY,
  type NotificationLocale,
} from "@teranga/shared-types";
import type { RenderedEmail } from "../email/render";

// ─── Notification Preview Service ──────────────────────────────────────────
// Phase 2.4 — renders a catalog notification with sample params and a
// requested locale, returning the full { subject, html, previewText }
// triplet so the admin UI can drop the HTML into an iframe (srcdoc) for
// a faithful client-side preview.
//
// Why not reuse the email dispatcher adapter directly?
//   - The adapter goes through emailService.sendToUser/sendDirect which
//     expects a real user + suppression list checks + Resend side effects.
//   - Preview is pure — no user lookup, no provider call, no audit log.
//
// The builder map mirrors EmailDispatcherAdapter's TEMPLATE_BUILDERS
// (one-to-one with NotificationDefinition.templates.email). Any drift
// between the two is caught by the unit test suite.
//
// Sensible sample-param defaults are baked in per-template so a preview
// of "registration.created" renders as a believable confirmation email
// even with no request-supplied params. The caller's `sampleParams` are
// merged over the defaults, so specific fields can be overridden without
// re-declaring the full param shape.

import {
  buildRegistrationEmail,
  buildRegistrationApprovedEmail,
  buildBadgeReadyEmail,
  buildEventCancelledEmail,
  buildEventReminderEmail,
  buildPaymentReceiptEmail,
  buildWelcomeEmail,
  buildNewsletterConfirmationEmail,
  buildEmailVerificationEmail,
  buildPasswordResetEmail,
  buildPaymentFailedEmail,
  buildInviteSentEmail,
  buildRegistrationCancelledEmail,
  buildEventRescheduledEmail,
  buildWaitlistPromotedEmail,
  buildRefundIssuedEmail,
  buildRefundFailedEmail,
  buildMemberUpdateEmail,
  buildSpeakerAddedEmail,
  buildSponsorAddedEmail,
  buildSubscriptionChangeEmail,
  buildPayoutCreatedEmail,
  buildPlatformWelcomeEmail,
  buildPasswordChangedEmail,
  buildEmailChangedEmail,
  buildSubscriptionPastDueEmail,
} from "../email/templates";

// ─── Sample param defaults ─────────────────────────────────────────────────
// Kept as a factory so dates are always relative to `now` at preview time.
// Shared fields first (every template reaches for at least a name or an
// event title); specific fields override per template id.

function buildSampleDefaults() {
  const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const dateFmt = new Intl.DateTimeFormat("fr-SN", { dateStyle: "long", timeStyle: "short" });
  const dateOnlyFmt = new Intl.DateTimeFormat("fr-SN", { dateStyle: "long" });

  // Common fields reused across templates.
  const participantName = "Marie Diop";
  const eventTitle = "Sample Event — Dakar Tech Summit";
  const eventDate = dateFmt.format(inSevenDays);
  const eventLocation = "Cicad, Diamniadio";
  const organizationName = "Teranga Events (exemple)";

  return {
    participantName,
    eventTitle,
    eventDate,
    eventLocation,
    organizationName,
    dateFmt,
    dateOnlyFmt,
    inSevenDays,
  };
}

type Builder = (params: Record<string, unknown>) => Promise<RenderedEmail>;

interface TemplateDefaultsEntry {
  /** react-email builder — same signature as the dispatcher adapter. */
  build: Builder;
  /** Preview sample params merged with the caller's `sampleParams`. */
  defaults: () => Record<string, unknown>;
}

function url(path: string): string {
  // Every admin preview runs against the local API, so the CTAs in the
  // rendered HTML can point at a placeholder. Kept as an https URL so
  // link colour/underline styles render faithfully.
  return `https://preview.teranga.events${path}`;
}

// Map template id (matches NotificationDefinition.templates.email) → builder + defaults.
const TEMPLATE_REGISTRY: Record<string, TemplateDefaultsEntry> = {
  RegistrationConfirmation: {
    build: buildRegistrationEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        eventDate: s.eventDate,
        eventLocation: s.eventLocation,
        ticketName: "Standard",
        registrationId: "reg_preview_12345",
        badgeUrl: url("/badges/preview.pdf"),
      };
    },
  },
  RegistrationApproved: {
    build: buildRegistrationApprovedEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        eventDate: s.eventDate,
        eventLocation: s.eventLocation,
        badgeUrl: url("/badges/preview.pdf"),
      };
    },
  },
  BadgeReady: {
    build: buildBadgeReadyEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        badgeUrl: url("/badges/preview.pdf"),
      };
    },
  },
  EventCancelled: {
    build: buildEventCancelledEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        reason: "L'événement est annulé pour raisons techniques (exemple).",
      };
    },
  },
  EventReminder: {
    build: buildEventReminderEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        eventDate: s.eventDate,
        eventLocation: s.eventLocation,
        timeUntil: "24 heures",
      };
    },
  },
  PaymentReceipt: {
    build: buildPaymentReceiptEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        amount: "25 000 FCFA",
        receiptId: "RCPT-2026-04-22-PREVIEW",
        paymentDate: s.dateFmt.format(new Date()),
      };
    },
  },
  NewsletterWelcome: {
    build: buildWelcomeEmail as unknown as Builder,
    defaults: () => ({ email: "marie.diop@example.com" }),
  },
  NewsletterConfirmation: {
    build: buildNewsletterConfirmationEmail as unknown as Builder,
    defaults: () => ({
      email: "marie.diop@example.com",
      confirmUrl: url("/newsletter/confirm?token=preview"),
    }),
  },
  EmailVerification: {
    build: buildEmailVerificationEmail as unknown as Builder,
    defaults: () => ({
      name: "Marie Diop",
      verifyUrl: url("/auth/action?mode=verifyEmail&oobCode=preview"),
    }),
  },
  PasswordReset: {
    build: buildPasswordResetEmail as unknown as Builder,
    defaults: () => ({
      resetUrl: url("/auth/action?mode=resetPassword&oobCode=preview"),
    }),
  },
  PaymentFailed: {
    build: buildPaymentFailedEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        amount: "25 000 FCFA",
        provider: "Wave",
        retryUrl: url("/payments/retry/preview"),
      };
    },
  },
  InviteSent: {
    build: buildInviteSentEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      const inSeven = s.dateFmt.format(s.inSevenDays);
      return {
        inviterName: "Amadou Ba",
        organizationName: s.organizationName,
        role: "co_organizer",
        acceptUrl: url("/invites/accept?token=preview"),
        expiresAt: inSeven,
      };
    },
  },
  RegistrationCancelled: {
    build: buildRegistrationCancelledEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        cancelledAt: s.dateFmt.format(new Date()),
        cancelledBy: "participant",
      };
    },
  },
  EventRescheduled: {
    build: buildEventRescheduledEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      const newDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        oldDate: s.eventDate,
        newDate: s.dateFmt.format(newDate),
        eventUrl: url("/events/preview"),
      };
    },
  },
  WaitlistPromoted: {
    build: buildWaitlistPromotedEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      const deadline = new Date(Date.now() + 48 * 60 * 60 * 1000);
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        eventDate: s.eventDate,
        eventLocation: s.eventLocation,
        confirmByDate: s.dateFmt.format(deadline),
        confirmUrl: url("/registrations/preview/confirm"),
      };
    },
  },
  RefundIssued: {
    build: buildRefundIssuedEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        amount: "25 000 FCFA",
        refundId: "REF-2026-04-22-PREVIEW",
        expectedArrival: "3 à 5 jours ouvrables",
      };
    },
  },
  RefundFailed: {
    build: buildRefundFailedEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        participantName: s.participantName,
        eventTitle: s.eventTitle,
        amount: "25 000 FCFA",
        refundId: "REF-2026-04-22-PREVIEW",
        supportUrl: url("/support"),
      };
    },
  },
  MemberUpdate: {
    build: buildMemberUpdateEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        memberName: s.participantName,
        organizationName: s.organizationName,
        kind: "added",
        newRole: "organizer",
        orgUrl: url("/dashboard"),
      };
    },
  },
  SpeakerAdded: {
    build: buildSpeakerAddedEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        speakerName: s.participantName,
        eventTitle: s.eventTitle,
        eventDate: s.eventDate,
        sessionTitle: "Fireside chat: IA en Afrique de l'Ouest",
        portalUrl: url("/speakers/preview"),
      };
    },
  },
  SponsorAdded: {
    build: buildSponsorAddedEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        sponsorContactName: s.participantName,
        sponsorCompanyName: "Sonatel (exemple)",
        eventTitle: s.eventTitle,
        eventDate: s.eventDate,
        portalUrl: url("/sponsors/preview"),
      };
    },
  },
  SubscriptionChange: {
    build: buildSubscriptionChangeEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        recipientName: s.participantName,
        organizationName: s.organizationName,
        kind: "upgraded",
        fromPlan: "Starter",
        toPlan: "Pro",
        effectiveAt: s.dateOnlyFmt.format(new Date()),
        billingUrl: url("/organization/billing"),
      };
    },
  },
  PayoutCreated: {
    build: buildPayoutCreatedEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        organizerName: "Amadou Ba",
        organizationName: s.organizationName,
        amount: "245 000 FCFA",
        eventTitle: s.eventTitle,
        expectedSettlementDate: s.dateOnlyFmt.format(s.inSevenDays),
        payoutId: "PAY-2026-04-22-PREVIEW",
        billingUrl: url("/organization/billing"),
      };
    },
  },
  Welcome: {
    build: buildPlatformWelcomeEmail as unknown as Builder,
    defaults: () => ({
      name: "Marie Diop",
      appUrl: url("/"),
      exploreEventsUrl: url("/events"),
    }),
  },
  PasswordChanged: {
    build: buildPasswordChangedEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        name: "Marie Diop",
        changedAt: s.dateFmt.format(new Date()),
        ipAddress: "41.82.x.x",
        city: "Dakar",
        supportUrl: url("/support"),
      };
    },
  },
  EmailChanged: {
    build: buildEmailChangedEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        name: "Marie Diop",
        oldEmail: "marie.diop@example.com",
        newEmail: "marie.d@example.org",
        changedAt: s.dateFmt.format(new Date()),
        supportUrl: url("/support"),
      };
    },
  },
  SubscriptionPastDue: {
    build: buildSubscriptionPastDueEmail as unknown as Builder,
    defaults: () => {
      const s = buildSampleDefaults();
      return {
        recipientName: s.participantName,
        organizationName: s.organizationName,
        planName: "Pro",
        amount: "29 900 FCFA",
        failureReason: "carte expirée",
        retryUrl: url("/organization/billing/retry"),
        gracePeriodEndsAt: s.dateOnlyFmt.format(s.inSevenDays),
      };
    },
  },
};

// ─── Service ───────────────────────────────────────────────────────────────

export interface PreviewResult {
  subject: string;
  html: string;
  /**
   * The short "preview" text used by email clients for the inbox line.
   * Distinct from the full plain-text fallback — mirrors `params.preview`
   * passed to EmailLayout. When the builder doesn't surface it explicitly
   * we derive a best-effort excerpt from the plain-text render.
   */
  previewText: string;
}

export class NotificationPreviewService {
  async preview(
    key: string,
    locale: NotificationLocale,
    sampleParams: Record<string, unknown> = {},
  ): Promise<PreviewResult> {
    const definition = NOTIFICATION_CATALOG_BY_KEY[key];
    if (!definition) {
      throw new Error(`Unknown notification key: ${key}`);
    }
    const templateId = definition.templates.email;
    if (!templateId) {
      throw new Error(`Notification ${key} has no email template`);
    }
    const entry = TEMPLATE_REGISTRY[templateId];
    if (!entry) {
      throw new Error(`Preview not supported for template: ${templateId}`);
    }

    // Merge caller-supplied params OVER defaults so the UI can override
    // any field without knowing the full shape.
    const params = {
      ...entry.defaults(),
      ...sampleParams,
      locale,
    };

    // react-email build — returns { subject, html, text }.
    const rendered = await entry.build(params);

    // Best-effort preview text: first non-empty line of the plain-text
    // render, capped at 140 chars so it fits in an inbox row.
    const firstLine = rendered.text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    const previewText = firstLine ? firstLine.slice(0, 140) : rendered.subject;

    return {
      subject: rendered.subject,
      html: rendered.html,
      previewText,
    };
  }
}

export const notificationPreviewService = new NotificationPreviewService();
