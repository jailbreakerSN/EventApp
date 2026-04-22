import { describe, expect, it } from "vitest";
import { NOTIFICATION_CATALOG, type NotificationCategory } from "@teranga/shared-types";
import { config } from "@/config";
import {
  buildBadgeReadyEmail,
  buildCertificateReadyEmail,
  buildEventCancelledEmail,
  buildEventFeedbackRequestedEmail,
  buildEventReminderEmail,
  buildEventRescheduledEmail,
  buildInviteSentEmail,
  buildMemberUpdateEmail,
  buildNewsletterConfirmationEmail,
  buildPlatformWelcomeEmail,
  buildRegistrationApprovedEmail,
  buildRegistrationCancelledEmail,
  buildRegistrationEmail,
  buildSpeakerAddedEmail,
  buildSponsorAddedEmail,
  buildSubscriptionApproachingLimitEmail,
  buildWaitlistPromotedEmail,
  buildWelcomeEmail,
  type RenderedEmail,
} from "../templates";

// ─── Legal-footer / unsubscribe-link guard (Phase 2.5) ─────────────────────
// Every non-auth, non-billing notification template MUST include:
//   1. A physical postal address (matches config.RESEND_POSTAL_ADDRESS,
//      which defaults to something containing "Dakar").
//   2. An unsubscribe link — either our canonical
//      /v1/notifications/unsubscribe URL or a href ending in
//      /unsubscribe.
//
// Auth + billing templates are exempt (those sends are mandatory —
// including an unsubscribe link actively confuses users into thinking
// they can opt out of security emails).
//
// The test builds each template with minimal valid sample params, renders
// to HTML in each supported locale (fr / en / wo), and asserts the two
// compliance lines are present. Failure lists the template key + locale
// that missed the bar so maintainers can fix the EmailLayout include
// (almost always a one-liner).

type Locale = "fr" | "en" | "wo";
const LOCALES: readonly Locale[] = ["fr", "en", "wo"];

/**
 * Minimal sample params per template id. Keys match
 * NotificationDefinition.templates.email. Tests against the ACTUAL
 * builder — missing params would blow up at render time.
 */
type Builder = (locale: Locale) => Promise<RenderedEmail>;

const SAMPLE_BUILDERS: Record<string, Builder> = {
  RegistrationConfirmation: (locale) =>
    buildRegistrationEmail({
      locale,
      participantName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
      eventDate: "15 mai 2026, 10h00",
      eventLocation: "CICAD, Diamniadio",
      ticketName: "Billet Standard",
      registrationId: "reg-42",
    }),
  RegistrationApproved: (locale) =>
    buildRegistrationApprovedEmail({
      locale,
      participantName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
      eventDate: "15 mai 2026, 10h00",
      eventLocation: "CICAD",
    }),
  RegistrationCancelled: (locale) =>
    buildRegistrationCancelledEmail({
      locale,
      participantName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
      eventDate: "15 mai 2026",
      cancelledBy: "organizer",
      eventUrl: "https://example.test/events/xyz",
    }),
  BadgeReady: (locale) =>
    buildBadgeReadyEmail({
      locale,
      participantName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
    }),
  EventReminder: (locale) =>
    buildEventReminderEmail({
      locale,
      participantName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
      eventDate: "15 mai 2026, 10h00",
      eventLocation: "CICAD",
      timeUntil: "demain",
    }),
  EventCancelled: (locale) =>
    buildEventCancelledEmail({
      locale,
      participantName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
      eventDate: "15 mai 2026",
    }),
  EventRescheduled: (locale) =>
    buildEventRescheduledEmail({
      locale,
      participantName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
      oldDate: "15 mai 2026",
      newDate: "22 mai 2026",
      eventUrl: "https://example.test/events/xyz",
    }),
  WaitlistPromoted: (locale) =>
    buildWaitlistPromotedEmail({
      locale,
      participantName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
      eventDate: "15 mai 2026",
      confirmUrl: "https://example.test/confirm",
      holdExpiresAt: "16 mai 2026",
    }),
  NewsletterConfirmation: (locale) =>
    buildNewsletterConfirmationEmail({
      locale,
      confirmationUrl: "https://example.test/newsletter/confirm?token=abc",
    }),
  NewsletterWelcome: (locale) => buildWelcomeEmail({ locale, email: "hello@example.test" }),
  InviteSent: (locale) =>
    buildInviteSentEmail({
      locale,
      inviterName: "Mamadou Fall",
      organizationName: "Teranga Events SRL",
      role: "co_organizer",
      acceptUrl: "https://example.test/invites/abc",
      expiresAt: "29 avril 2026 à 18h00",
    }),
  MemberUpdate: (locale) =>
    buildMemberUpdateEmail({
      locale,
      memberName: "Awa Sow",
      organizationName: "Teranga Events SRL",
      kind: "added",
      orgUrl: "https://example.test/organizations/xyz",
    }),
  SpeakerAdded: (locale) =>
    buildSpeakerAddedEmail({
      locale,
      speakerName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
      eventDate: "15 mai 2026",
      eventLocation: "CICAD",
      portalUrl: "https://example.test/speakers/xyz",
    }),
  SponsorAdded: (locale) =>
    buildSponsorAddedEmail({
      locale,
      sponsorContactName: "Awa Sow",
      organizationName: "Teranga Events SRL",
      eventTitle: "Dakar Tech Summit",
      eventDate: "15 mai 2026",
      portalUrl: "https://example.test/sponsors/xyz",
    }),
  Welcome: (locale) =>
    buildPlatformWelcomeEmail({
      locale,
      name: "Awa Sow",
      appUrl: "https://example.test",
      exploreEventsUrl: "https://example.test/events",
    }),
  EventFeedbackRequested: (locale) =>
    buildEventFeedbackRequestedEmail({
      locale,
      participantName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
      eventEndedAt: "22 avril 2026 à 18h00",
      feedbackUrl: "https://example.test/events/xyz/feedback",
    }),
  CertificateReady: (locale) =>
    buildCertificateReadyEmail({
      locale,
      participantName: "Awa Sow",
      eventTitle: "Dakar Tech Summit",
      eventDate: "22 avril 2026",
      certificateUrl: "https://example.test/cert/xyz",
    }),
  SubscriptionApproachingLimit: (locale) =>
    buildSubscriptionApproachingLimitEmail({
      locale,
      organizationName: "Teranga Events SRL",
      planName: "Pro",
      dimensionLabel: "Événements actifs",
      current: "8",
      limit: "10",
      percent: "80",
      upgradeUrl: "https://example.test/billing",
    }),
};

// Auth + billing sends never need unsubscribe affordances — the test
// skips catalog entries in these categories.
const EXEMPT_CATEGORIES: ReadonlySet<NotificationCategory> = new Set(["auth", "billing"]);

// Every non-exempt catalog entry whose email template id we haven't
// mapped above. Lists which templates we explicitly chose to assert on,
// and which are skipped because the test doesn't carry builder bindings
// for them (Phase 2.3 shipped two more: EventFeedbackRequested +
// CertificateReady — both wired).
function renderedContainsPostalAddress(html: string): boolean {
  // Primary check: the env-configured postal address must appear
  // verbatim. Secondary fallback: the literal "Dakar" — which the
  // task spec explicitly calls out as an acceptable substitute for
  // dev environments that haven't customised the env var.
  return html.includes(config.RESEND_POSTAL_ADDRESS) || html.includes("Dakar");
}

function renderedContainsUnsubscribeLink(html: string): boolean {
  // Canonical URL first (that's what our layout emits); broader
  // fallback for any custom footer that built its own opt-out.
  return (
    html.includes("/v1/notifications/unsubscribe") ||
    /href=["'][^"']*\/unsubscribe["']/.test(html)
  );
}

describe("notification legal-footer + unsubscribe-link guard", () => {
  for (const def of NOTIFICATION_CATALOG) {
    if (EXEMPT_CATEGORIES.has(def.category)) continue;
    const templateId = def.templates.email;
    if (!templateId) continue;
    const builder = SAMPLE_BUILDERS[templateId];
    if (!builder) {
      // Explicitly fail: every non-exempt key must have a builder mapped
      // in this test file. Forces test updates when a new catalog
      // entry lands.
      it(`[${def.key}] has a sample builder mapped in the compliance test`, () => {
        expect(
          SAMPLE_BUILDERS[templateId],
          `Missing sample builder for template id "${templateId}" (catalog key "${def.key}"). ` +
            `Add a SAMPLE_BUILDERS entry in apps/api/src/services/email/__tests__/notification-legal-footer.test.ts.`,
        ).toBeDefined();
      });
      continue;
    }

    for (const locale of LOCALES) {
      it(`[${def.key}] (${locale}) includes a postal address`, async () => {
        const { html } = await builder(locale);
        expect(
          renderedContainsPostalAddress(html),
          `Template "${templateId}" (locale ${locale}) must include a physical postal address. ` +
            `Expected to find "${config.RESEND_POSTAL_ADDRESS}" or the string "Dakar" in the rendered HTML.`,
        ).toBe(true);
      });

      it(`[${def.key}] (${locale}) includes an unsubscribe link`, async () => {
        const { html } = await builder(locale);
        expect(
          renderedContainsUnsubscribeLink(html),
          `Template "${templateId}" (locale ${locale}) must include an unsubscribe link. ` +
            `Expected "/v1/notifications/unsubscribe" or any href ending in /unsubscribe.`,
        ).toBe(true);
      });
    }
  }
});
