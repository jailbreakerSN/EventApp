import {
  type EmailChannelAdapter,
  type EmailChannelDispatchParams,
  type EmailChannelDispatchResult,
  setEmailChannelAdapter,
} from "../notification-dispatcher.service";
import { asLocale, type Locale } from "./i18n";
import { type EmailCategory } from "@teranga/shared-types";
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
  // Phase 2 builders
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
  type RenderedEmail,
} from "./templates";

// ─── Email Channel Adapter ─────────────────────────────────────────────────
// Bridge between the channel-agnostic NotificationDispatcherService and
// the existing Resend + react-email stack. Takes a NotificationDefinition
// + recipient + raw params, renders the right react-email template, then
// routes through the long-standing emailService.sendToUser / sendDirect
// helpers so the suppression list, per-category preferences, List-Unsubscribe
// header injection, and provider retry budget all keep working unchanged.
//
// Registered as the dispatcher's email adapter on module import. A second
// import from tests replaces this with a mock via `setEmailChannelAdapter`.
//
// Adding a new template in Phase 2 = add a new entry to TEMPLATE_BUILDERS +
// a new catalog entry in shared-types. No dispatcher changes.

// ─── Template registry ─────────────────────────────────────────────────────

type TemplateBuilder = (
  params: Record<string, unknown> & { locale?: Locale },
) => Promise<RenderedEmail>;

interface TemplateEntry {
  build: TemplateBuilder;
  /** Maps the catalog category hint onto the emailService EmailCategory. */
  category: EmailCategory;
  /** Analytics tag written into Resend — mirrors pre-dispatcher value. */
  tagType: string;
}

// Template id in the catalog → builder + routing info. Keys match
// `NotificationDefinition.templates.email` in
// packages/shared-types/src/notification-catalog.ts.
const TEMPLATE_BUILDERS: Record<string, TemplateEntry> = {
  RegistrationConfirmation: {
    build: buildRegistrationEmail as unknown as TemplateBuilder,
    category: "transactional",
    tagType: "registration_confirmation",
  },
  RegistrationApproved: {
    build: buildRegistrationApprovedEmail as unknown as TemplateBuilder,
    category: "transactional",
    tagType: "registration_approved",
  },
  BadgeReady: {
    build: buildBadgeReadyEmail as unknown as TemplateBuilder,
    category: "transactional",
    tagType: "badge_ready",
  },
  EventCancelled: {
    build: buildEventCancelledEmail as unknown as TemplateBuilder,
    category: "transactional",
    tagType: "event_cancelled",
  },
  EventReminder: {
    build: buildEventReminderEmail as unknown as TemplateBuilder,
    category: "transactional",
    tagType: "event_reminder",
  },
  PaymentReceipt: {
    build: buildPaymentReceiptEmail as unknown as TemplateBuilder,
    category: "billing",
    tagType: "payment_receipt",
  },
  NewsletterWelcome: {
    build: buildWelcomeEmail as unknown as TemplateBuilder,
    category: "marketing",
    tagType: "newsletter_welcome",
  },
  NewsletterConfirmation: {
    build: buildNewsletterConfirmationEmail as unknown as TemplateBuilder,
    category: "transactional",
    tagType: "newsletter_confirmation",
  },
  EmailVerification: {
    build: buildEmailVerificationEmail as unknown as TemplateBuilder,
    category: "auth",
    tagType: "email_verification",
  },
  PasswordReset: {
    build: buildPasswordResetEmail as unknown as TemplateBuilder,
    category: "auth",
    tagType: "password_reset",
  },
  // ─── Phase 2 templates ─────────────────────────────────────────────────
  PaymentFailed: {
    build: buildPaymentFailedEmail as unknown as TemplateBuilder,
    category: "billing",
    tagType: "payment_failed",
  },
  InviteSent: {
    build: buildInviteSentEmail as unknown as TemplateBuilder,
    category: "transactional",
    tagType: "invite_sent",
  },
  RegistrationCancelled: {
    build: buildRegistrationCancelledEmail as unknown as TemplateBuilder,
    category: "transactional",
    tagType: "registration_cancelled",
  },
  EventRescheduled: {
    build: buildEventRescheduledEmail as unknown as TemplateBuilder,
    category: "transactional",
    tagType: "event_rescheduled",
  },
  WaitlistPromoted: {
    build: buildWaitlistPromotedEmail as unknown as TemplateBuilder,
    category: "transactional",
    tagType: "waitlist_promoted",
  },
  RefundIssued: {
    build: buildRefundIssuedEmail as unknown as TemplateBuilder,
    category: "billing",
    tagType: "refund_issued",
  },
  RefundFailed: {
    build: buildRefundFailedEmail as unknown as TemplateBuilder,
    category: "billing",
    tagType: "refund_failed",
  },
  MemberUpdate: {
    build: buildMemberUpdateEmail as unknown as TemplateBuilder,
    category: "organizational",
    tagType: "member_update",
  },
  SpeakerAdded: {
    build: buildSpeakerAddedEmail as unknown as TemplateBuilder,
    category: "organizational",
    tagType: "speaker_added",
  },
  SponsorAdded: {
    build: buildSponsorAddedEmail as unknown as TemplateBuilder,
    category: "organizational",
    tagType: "sponsor_added",
  },
  SubscriptionChange: {
    build: buildSubscriptionChangeEmail as unknown as TemplateBuilder,
    category: "billing",
    tagType: "subscription_change",
  },
  PayoutCreated: {
    build: buildPayoutCreatedEmail as unknown as TemplateBuilder,
    category: "billing",
    tagType: "payout_created",
  },
  Welcome: {
    build: buildPlatformWelcomeEmail as unknown as TemplateBuilder,
    category: "marketing",
    tagType: "platform_welcome",
  },
  PasswordChanged: {
    build: buildPasswordChangedEmail as unknown as TemplateBuilder,
    category: "auth",
    tagType: "password_changed",
  },
  EmailChanged: {
    build: buildEmailChangedEmail as unknown as TemplateBuilder,
    category: "auth",
    tagType: "email_changed",
  },
  SubscriptionPastDue: {
    build: buildSubscriptionPastDueEmail as unknown as TemplateBuilder,
    category: "billing",
    tagType: "subscription_past_due",
  },
};

// ─── Adapter ───────────────────────────────────────────────────────────────

class EmailDispatcherAdapter implements EmailChannelAdapter {
  async send(params: EmailChannelDispatchParams): Promise<EmailChannelDispatchResult> {
    const templateId = params.definition.templates.email;
    if (!templateId) {
      return { ok: false, suppressed: "no_recipient" };
    }

    const entry = TEMPLATE_BUILDERS[templateId];
    if (!entry) {
      // Catalog references a template builder we haven't wired yet —
      // this is a Phase 2 work-in-progress state. Never crash, just
      // surface the gap through the suppression audit trail.
      return { ok: false, suppressed: "no_recipient" };
    }

    const locale = asLocale(params.recipient.preferredLocale) ?? "fr";

    // Lazy import of emailService to avoid the boot cycle (emailService
    // imports templates → templates are also referenced here). Node's
    // module cache dedup's the import so there's no real cost.
    const { emailService } = await import("../email.service");

    try {
      if (params.recipient.userId) {
        // User-scoped send — emailService resolves the user's preferred
        // language itself, so we hand it a factory closed over the template.
        await emailService.sendToUser(
          params.recipient.userId,
          async (resolvedLocale) =>
            entry.build({ ...params.templateParams, locale: resolvedLocale }),
          entry.category,
          {
            tags: [{ name: "type", value: entry.tagType }],
            idempotencyKey: params.idempotencyKey,
          },
        );
      } else if (params.recipient.email) {
        const rendered = await entry.build({ ...params.templateParams, locale });
        await emailService.sendDirect(params.recipient.email, rendered, entry.category, {
          tags: [{ name: "type", value: entry.tagType }],
          idempotencyKey: params.idempotencyKey,
        });
      } else {
        return { ok: false, suppressed: "no_recipient" };
      }
      // emailService.sendToUser / sendDirect swallow errors — we can't
      // distinguish "provider said yes" from "provider said no" here
      // without reworking the emailService interface (out of scope for
      // Phase 1). Report ok=true; Phase 5 observability will plumb real
      // delivery status through the Resend webhook pipeline.
      return { ok: true };
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "error",
          event: "email_adapter_error",
          templateId,
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
      return { ok: false, suppressed: "bounced" };
    }
  }
}

// Register as the dispatcher's default email adapter. Tests override
// via setEmailChannelAdapter().
export const emailDispatcherAdapter = new EmailDispatcherAdapter();
setEmailChannelAdapter(emailDispatcherAdapter);

/** Expose the template map for diagnostics / admin UI previews. */
export function listEmailTemplateIds(): string[] {
  return Object.keys(TEMPLATE_BUILDERS);
}
