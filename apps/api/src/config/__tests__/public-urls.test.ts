import { describe, it, expect, vi } from "vitest";

// Mock the config BEFORE importing the module under test. The builders
// interpolate config.*_URL at call time, so this mock determines what
// they produce. Test values match prod-shape (HTTPS, real domain) so a
// regression that accidentally falls back to a localhost default is
// visible at a glance.
vi.mock("@/config", () => ({
  config: {
    API_BASE_URL: "https://api.terangaevent.com",
    PARTICIPANT_WEB_URL: "https://app.terangaevent.com",
    WEB_BACKOFFICE_URL: "https://admin.terangaevent.com",
  },
}));

import {
  newsletterConfirmUrl,
  unsubscribeUrl,
  paymentWebhookUrl,
  paymentReturnUrl,
  paymentMockCheckoutUrl,
  getOwnedWebHosts,
} from "../public-urls";

describe("public-urls", () => {
  describe("newsletterConfirmUrl", () => {
    it("builds an absolute https URL with the token URL-encoded", () => {
      const url = newsletterConfirmUrl("abc.def/ghi+jkl");
      expect(url).toBe(
        "https://api.terangaevent.com/v1/newsletter/confirm?token=abc.def%2Fghi%2Bjkl",
      );
    });

    it("is domain-change-safe — only API_BASE_URL controls the host", () => {
      // Sanity: the output starts with exactly the configured base
      // (no hardcoded localhost slipping through).
      expect(newsletterConfirmUrl("t")).toMatch(/^https:\/\/api\.terangaevent\.com\//);
    });
  });

  describe("unsubscribeUrl", () => {
    it("builds an absolute https URL with the token URL-encoded", () => {
      const url = unsubscribeUrl("tok+en=value");
      expect(url).toBe(
        "https://api.terangaevent.com/v1/notifications/unsubscribe?token=tok%2Ben%3Dvalue",
      );
    });
  });

  describe("paymentWebhookUrl", () => {
    it("embeds the method as a URL-encoded path segment", () => {
      expect(paymentWebhookUrl("wave")).toBe(
        "https://api.terangaevent.com/v1/payments/webhook/wave",
      );
    });

    it("encodes special characters in the method (defence-in-depth; method is internal)", () => {
      expect(paymentWebhookUrl("weird/method")).toBe(
        "https://api.terangaevent.com/v1/payments/webhook/weird%2Fmethod",
      );
    });
  });

  describe("paymentReturnUrl", () => {
    it("points at PARTICIPANT_WEB_URL, not API_BASE_URL", () => {
      // Regression guard — payment return URLs go to the participant
      // web app, never to the API. A refactor mis-wiring would send
      // users to a JSON-returning endpoint after paying.
      expect(paymentReturnUrl("ev-1", "pay-1")).toBe(
        "https://app.terangaevent.com/register/ev-1/payment-status?paymentId=pay-1",
      );
    });

    it("encodes both eventId and paymentId", () => {
      expect(paymentReturnUrl("ev/1", "pay?2")).toBe(
        "https://app.terangaevent.com/register/ev%2F1/payment-status?paymentId=pay%3F2",
      );
    });
  });

  describe("paymentMockCheckoutUrl", () => {
    it("lives on the API base and encodes the tx id", () => {
      expect(paymentMockCheckoutUrl("tx-42/x")).toBe(
        "https://api.terangaevent.com/v1/payments/mock-checkout/tx-42%2Fx",
      );
    });
  });

  describe("getOwnedWebHosts", () => {
    it("returns only the participant + backoffice hosts (not the API)", () => {
      // The allowlist guards payment returnUrls — the API is never a
      // legitimate payment-return target, and including it would turn
      // the allowlist into a same-origin bypass for phishing redirects.
      const hosts = getOwnedWebHosts();
      expect(hosts).toEqual(
        expect.arrayContaining(["app.terangaevent.com", "admin.terangaevent.com"]),
      );
      expect(hosts).not.toContain("api.terangaevent.com");
      expect(hosts).toHaveLength(2);
    });

    it("lowercases hosts so case-only variants don't bypass the allowlist", () => {
      const hosts = getOwnedWebHosts();
      for (const h of hosts) expect(h).toBe(h.toLowerCase());
    });
  });
});
