import { describe, it, expect, vi } from "vitest";

vi.mock("@/config", () => ({
  config: {
    RESEND_FROM_NAME: "Teranga Events",
    RESEND_FROM_EMAIL: "events@terangaevent.com",
    RESEND_FROM_EVENTS: "events@terangaevent.com",
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
  it("maps auth and transactional to the events@ sender with support reply-to", () => {
    // Regression guard: Resend's deliverability analyzer flags no-reply@
    // senders (Gmail/Yahoo/Microsoft bulk-sender rules, 2024). If a
    // future refactor points these categories back at a no-reply
    // address, this test fails loudly. Reply-To still targets support@
    // so replies reach a human even though the sender mailbox exists.
    for (const category of ["auth", "transactional"] as const) {
      const s = resolveSender(category);
      expect(s.from).toBe("Teranga Events <events@terangaevent.com>");
      expect(s.from).not.toMatch(/no[-_]?reply/i);
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
