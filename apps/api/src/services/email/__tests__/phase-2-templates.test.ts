import { describe, it, expect } from "vitest";
import {
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
} from "../templates";

// ─── Phase 2 template smoke tests ──────────────────────────────────────────
// Renders every Phase 2 notification with a sample params payload. We
// assert subject + heading + a body token to catch:
//   * missing locale keys (would show up as `undefined` in HTML)
//   * JSX import errors
//   * Intl.NumberFormat / Date fallbacks breaking when a param is absent
//
// Coverage rationale: each template has its own i18n block — smoke-rendering
// every one in French + English + Wolof would triple the assertion count
// for diminishing value. We check French (default, source of truth) here
// and trust the shared NotificationTemplate + pickMessages helpers for the
// locale routing (those are exercised in notification-catalog + dispatcher
// tests). English / Wolof paths are contract-tested at the typing level
// (Dictionary interface strictness).

describe("phase-2 email templates render in French", () => {
  it("payment.failed", async () => {
    const r = await buildPaymentFailedEmail({
      participantName: "Awa",
      amount: "25 000 FCFA",
      eventTitle: "Summit",
      retryUrl: "https://x/retry",
    });
    expect(r.subject).toContain("Paiement");
    expect(r.html).toContain("Réessayer");
    expect(r.html).toContain("25 000 FCFA");
  });

  it("invite.sent (speaker)", async () => {
    const r = await buildInviteSentEmail({
      inviterName: "Ousmane",
      organizationName: "Teranga Events",
      role: "speaker",
      eventTitle: "Dakar Tech",
      acceptUrl: "https://x/accept",
      expiresAt: "dans 7 jours",
    });
    expect(r.subject).toContain("Teranga Events");
    expect(r.html).toContain("Accepter");
  });

  it("registration.cancelled (self + refund)", async () => {
    const r = await buildRegistrationCancelledEmail({
      participantName: "Awa",
      eventTitle: "Summit",
      eventDate: "15 mai",
      cancelledBy: "self",
      refundAmount: "10 000 FCFA",
      eventUrl: "https://x/events",
    });
    expect(r.subject).toContain("annulée");
    expect(r.html).toContain("10 000 FCFA");
  });

  it("event.rescheduled", async () => {
    const r = await buildEventRescheduledEmail({
      participantName: "Awa",
      eventTitle: "Summit",
      oldDate: "15 mai",
      newDate: "30 mai",
      eventUrl: "https://x/events",
    });
    expect(r.subject).toContain("reprogrammé");
    expect(r.html).toContain("Nouvelle date");
  });

  it("waitlist.promoted", async () => {
    const r = await buildWaitlistPromotedEmail({
      participantName: "Awa",
      eventTitle: "Summit",
      eventDate: "15 mai",
      confirmUrl: "https://x/confirm",
      holdExpiresAt: "17 mai à 18h",
    });
    expect(r.subject).toContain("place");
    expect(r.html).toContain("Confirmer");
  });

  it("refund.issued", async () => {
    const r = await buildRefundIssuedEmail({
      participantName: "Awa",
      amount: "10 000 FCFA",
      eventTitle: "Summit",
      refundId: "rf-1",
      provider: "Wave",
      expectedSettlementDays: 5,
    });
    expect(r.subject).toContain("Remboursement");
    expect(r.html).toContain("Wave");
  });

  it("refund.failed", async () => {
    const r = await buildRefundFailedEmail({
      participantName: "Awa",
      amount: "10 000 FCFA",
      eventTitle: "Summit",
      supportUrl: "mailto:support",
    });
    expect(r.subject).toContain("Remboursement");
    expect(r.html).toContain("support");
  });

  it("member.added", async () => {
    const r = await buildMemberUpdateEmail({
      memberName: "Awa",
      organizationName: "Teranga",
      kind: "added",
      orgUrl: "https://x/org",
    });
    expect(r.subject).toContain("Bienvenue");
  });

  it("member.role_changed", async () => {
    const r = await buildMemberUpdateEmail({
      memberName: "Awa",
      organizationName: "Teranga",
      kind: "role_changed",
      oldRole: "member",
      newRole: "organizer",
      orgUrl: "https://x/org",
    });
    expect(r.html).toContain("organizer");
  });

  it("speaker.added", async () => {
    const r = await buildSpeakerAddedEmail({
      speakerName: "Awa",
      eventTitle: "Summit",
      eventDate: "15 mai",
      eventLocation: "CICAD",
      portalUrl: "https://x/portal",
    });
    expect(r.subject).toContain("intervenant");
  });

  it("sponsor.added", async () => {
    const r = await buildSponsorAddedEmail({
      sponsorContactName: "Ousmane",
      organizationName: "Acme",
      eventTitle: "Summit",
      eventDate: "15 mai",
      portalUrl: "https://x/sponsor",
    });
    expect(r.subject).toContain("sponsor");
  });

  it("subscription.upgraded", async () => {
    const r = await buildSubscriptionChangeEmail({
      organizationName: "Teranga",
      kind: "upgraded",
      fromPlan: "Free",
      toPlan: "Pro",
      effectiveAt: "1 mai",
      billingUrl: "https://x/billing",
    });
    expect(r.subject).toContain("Pro");
    expect(r.html).toContain("niveau");
  });

  it("payout.created", async () => {
    const r = await buildPayoutCreatedEmail({
      organizationName: "Teranga",
      amount: "100 000 FCFA",
      expectedSettlementDate: "5 mai",
      payoutId: "po-1",
      billingUrl: "https://x/billing",
    });
    expect(r.subject).toContain("Virement");
    expect(r.html).toContain("100 000 FCFA");
  });

  it("welcome (platform signup)", async () => {
    const r = await buildPlatformWelcomeEmail({
      name: "Awa",
      appUrl: "https://x",
      exploreEventsUrl: "https://x/events",
    });
    expect(r.subject).toContain("Bienvenue");
    expect(r.html).toContain("Awa");
  });

  it("user.password_changed", async () => {
    const r = await buildPasswordChangedEmail({
      name: "Awa",
      changedAt: "20 avril 2026, 10h",
      ipAddress: "1.2.3.4",
      city: "Dakar",
      supportUrl: "mailto:support",
    });
    expect(r.subject).toContain("mot de passe");
    expect(r.html).toContain("Dakar");
  });

  it("user.email_changed (sent to old address)", async () => {
    const r = await buildEmailChangedEmail({
      name: "Awa",
      oldEmail: "old@x.co",
      newEmail: "new@x.co",
      changedAt: "20 avril 2026",
      supportUrl: "mailto:support",
    });
    expect(r.subject).toContain("e-mail");
    expect(r.html).toContain("old@x.co");
    expect(r.html).toContain("new@x.co");
  });

  it("subscription.past_due", async () => {
    const r = await buildSubscriptionPastDueEmail({
      organizationName: "Teranga",
      planName: "Pro",
      amount: "29 900 FCFA",
      retryUrl: "https://x/retry",
      gracePeriodEndsAt: "1 mai 2026",
    });
    expect(r.subject).toContain("Teranga");
    expect(r.html).toContain("29 900 FCFA");
  });
});
