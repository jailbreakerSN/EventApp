import { describe, it, expect, vi } from "vitest";

vi.mock("@/config", () => ({
  config: {
    RESEND_FROM_NAME: "Teranga Events",
    RESEND_FROM_EMAIL: "no-reply@terangaevent.com",
    RESEND_FROM_NOREPLY: "no-reply@terangaevent.com",
    RESEND_FROM_HELLO: "hello@terangaevent.com",
    RESEND_FROM_BILLING: "billing@terangaevent.com",
    RESEND_FROM_NEWS: "news@terangaevent.com",
    RESEND_REPLY_TO_SUPPORT: "support@terangaevent.com",
    RESEND_REPLY_TO_BILLING: "billing@terangaevent.com",
    RESEND_REPLY_TO_CONTACT: "contact@terangaevent.com",
  },
}));

import { resolveSender } from "../sender.registry";

describe("resolveSender", () => {
  it("maps auth and transactional to the no-reply sender with support reply-to", () => {
    for (const category of ["auth", "transactional"] as const) {
      const s = resolveSender(category);
      expect(s.from).toBe("Teranga Events <no-reply@terangaevent.com>");
      expect(s.replyTo).toBe("support@terangaevent.com");
      expect(s.tags).toEqual([{ name: "category", value: category }]);
    }
  });

  it("maps organizational to hello@ with support reply-to", () => {
    const s = resolveSender("organizational");
    expect(s.from).toBe("Teranga Events <hello@terangaevent.com>");
    expect(s.replyTo).toBe("support@terangaevent.com");
    expect(s.tags).toEqual([{ name: "category", value: "organizational" }]);
  });

  it("maps billing to billing@ with billing reply-to", () => {
    const s = resolveSender("billing");
    expect(s.from).toBe("Teranga Events <billing@terangaevent.com>");
    expect(s.replyTo).toBe("billing@terangaevent.com");
    expect(s.tags).toEqual([{ name: "category", value: "billing" }]);
  });

  it("maps marketing to news@ with contact reply-to", () => {
    const s = resolveSender("marketing");
    expect(s.from).toBe("Teranga Events <news@terangaevent.com>");
    expect(s.replyTo).toBe("contact@terangaevent.com");
    expect(s.tags).toEqual([{ name: "category", value: "marketing" }]);
  });
});
