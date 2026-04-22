import { describe, it, expect } from "vitest";
import {
  buildEventFeedbackRequestedEmail,
  buildCertificateReadyEmail,
  buildSubscriptionExpiringSoonEmail,
  buildSubscriptionApproachingLimitEmail,
} from "../templates";

// ─── Phase 2.3 template smoke tests ────────────────────────────────────────
// Each new lifecycle template must render in all three locales (fr/en/wo)
// without throwing. We assert subject + a body token per locale so a
// missing key would surface as "undefined" in HTML and fail the check.

const LOCALES = ["fr", "en", "wo"] as const;

describe("phase-2.3 email templates render in every locale", () => {
  describe("event.feedback_requested", () => {
    for (const locale of LOCALES) {
      it(`${locale} renders`, async () => {
        const r = await buildEventFeedbackRequestedEmail({
          participantName: "Awa",
          eventTitle: "Dakar Summit",
          eventEndedAt: "22 avril 2026 à 18h00",
          feedbackUrl: "https://teranga.dev/events/dakar-summit/feedback",
          feedbackDeadline: "29 avril 2026",
          locale,
        });
        expect(r.subject.length).toBeGreaterThan(0);
        expect(r.html).toContain("Dakar Summit");
        expect(r.html).not.toContain("undefined");
        expect(r.html).toContain("https://teranga.dev/events/dakar-summit/feedback");
      });
    }
  });

  describe("certificate.ready", () => {
    for (const locale of LOCALES) {
      it(`${locale} renders`, async () => {
        const r = await buildCertificateReadyEmail({
          participantName: "Ousmane",
          eventTitle: "Tech Meetup",
          eventDate: "22 avril 2026",
          certificateUrl: "https://teranga.dev/events/meetup/certificate",
          validityHint: "30 jours",
          locale,
        });
        expect(r.subject.length).toBeGreaterThan(0);
        expect(r.html).toContain("Tech Meetup");
        expect(r.html).not.toContain("undefined");
      });
    }

    it("renders without optional validityHint", async () => {
      const r = await buildCertificateReadyEmail({
        eventTitle: "Event",
        eventDate: "2026-04-22",
        certificateUrl: "https://x/cert",
        locale: "fr",
      });
      expect(r.html).not.toContain("undefined");
    });
  });

  describe("subscription.expiring_soon", () => {
    for (const locale of LOCALES) {
      it(`${locale} renders`, async () => {
        const r = await buildSubscriptionExpiringSoonEmail({
          organizationName: "Teranga Events SRL",
          planName: "pro",
          amount: "29 900 FCFA",
          renewalDate: "29 avril 2026",
          daysUntilRenewal: 7,
          manageBillingUrl: "/organization/billing",
          locale,
        });
        expect(r.subject.length).toBeGreaterThan(0);
        expect(r.html).toContain("Teranga Events SRL");
        expect(r.html).toContain("29 900 FCFA");
        expect(r.html).not.toContain("undefined");
      });
    }
  });

  describe("subscription.approaching_limit", () => {
    for (const locale of LOCALES) {
      it(`${locale} renders`, async () => {
        const r = await buildSubscriptionApproachingLimitEmail({
          organizationName: "Dakar Digital Hub",
          planName: "starter",
          dimensionLabel: "Événements actifs",
          current: "8",
          limit: "10",
          percent: "80",
          upgradeUrl: "/organization/billing",
          locale,
        });
        expect(r.subject.length).toBeGreaterThan(0);
        expect(r.html).toContain("Dakar Digital Hub");
        expect(r.html).not.toContain("undefined");
      });
    }
  });
});
