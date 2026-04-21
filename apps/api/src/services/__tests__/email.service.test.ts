import { describe, it, expect, vi, beforeEach } from "vitest";

// Provide a stable config mock before importing the service so the sender
// registry resolves deterministic addresses in every assertion.
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

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSend = vi.fn().mockResolvedValue({ success: true, messageId: "msg-1" });
const mockSendBulk = vi.fn().mockResolvedValue({ total: 2, sent: 2, failed: 0, results: [] });

vi.mock("@/providers/index", () => ({
  getEmailProvider: () => ({
    name: "mock",
    send: mockSend,
    sendBulk: mockSendBulk,
  }),
}));

// Template builders are mocked to record the locale they were called with.
// This proves the service forwards user.preferredLanguage correctly without
// needing to actually render JSX in a unit test.
const mockBuildRegistration = vi.fn(async (p: { eventTitle: string; locale?: string }) => ({
  subject: `reg-conf:${p.eventTitle}`,
  html: `<p>reg-conf ${p.locale ?? "fr"}</p>`,
  text: `reg-conf ${p.locale ?? "fr"}`,
}));
const mockBuildApproved = vi.fn(async (p: { eventTitle: string; locale?: string }) => ({
  subject: `approved:${p.eventTitle}`,
  html: `<p>approved</p>`,
  text: "approved",
}));
const mockBuildBadgeReady = vi.fn(async (p: { eventTitle: string; locale?: string }) => ({
  subject: `badge:${p.eventTitle}`,
  html: `<p>badge</p>`,
  text: "badge",
}));
const mockBuildCancelled = vi.fn(async (p: { eventTitle: string; locale?: string }) => ({
  subject: `cancel:${p.eventTitle}`,
  html: `<p>cancel</p>`,
  text: "cancel",
}));
const mockBuildReminder = vi.fn(async (p: { eventTitle: string; locale?: string }) => ({
  subject: `reminder:${p.eventTitle}`,
  html: `<p>reminder</p>`,
  text: "reminder",
}));
const mockBuildWelcome = vi.fn(async (p: { locale?: string } = {}) => ({
  subject: "welcome",
  html: `<p>welcome ${p.locale ?? "fr"}</p>`,
  text: `welcome ${p.locale ?? "fr"}`,
}));
const mockBuildReceipt = vi.fn(async (p: { amount: string; locale?: string }) => ({
  subject: `receipt:${p.amount}`,
  html: `<p>receipt</p>`,
  text: "receipt",
}));

vi.mock("@/services/email/templates", () => ({
  buildRegistrationEmail: (...args: unknown[]) => mockBuildRegistration(args[0] as never),
  buildRegistrationApprovedEmail: (...args: unknown[]) => mockBuildApproved(args[0] as never),
  buildBadgeReadyEmail: (...args: unknown[]) => mockBuildBadgeReady(args[0] as never),
  buildEventCancelledEmail: (...args: unknown[]) => mockBuildCancelled(args[0] as never),
  buildEventReminderEmail: (...args: unknown[]) => mockBuildReminder(args[0] as never),
  buildWelcomeEmail: (...args: unknown[]) => mockBuildWelcome(args[0] as never),
  buildPaymentReceiptEmail: (...args: unknown[]) => mockBuildReceipt(args[0] as never),
}));

const mockPrefsGet = vi.fn();

vi.mock("@/config/firebase", () => ({
  db: {
    collection: () => ({
      doc: () => ({
        get: mockPrefsGet,
      }),
    }),
  },
  COLLECTIONS: {
    NOTIFICATION_PREFERENCES: "notificationPreferences",
  },
}));

const mockUserFindById = vi.fn();

vi.mock("@/repositories/user.repository", () => ({
  userRepository: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "findById") return mockUserFindById;
        return undefined;
      },
    },
  ),
}));

import { EmailService } from "../email.service";

// ─── Helpers ────────────────────────────────────────────────────────────────

const stubTemplate = async (locale: "fr" | "en" | "wo") => ({
  subject: `Subject ${locale}`,
  html: `<p>HTML ${locale}</p>`,
  text: `Text ${locale}`,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("EmailService", () => {
  let service: EmailService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmailService();
  });

  describe("getPreferences", () => {
    it("returns defaults when no preference document exists", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      expect(await service.getPreferences("user-1")).toEqual({
        email: true,
        sms: true,
        push: true,
      });
    });

    it("returns stored preferences when document exists", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, sms: true, push: false }),
      });
      expect(await service.getPreferences("user-1")).toEqual({
        email: false,
        sms: true,
        push: false,
      });
    });

    it("returns defaults on error", async () => {
      mockPrefsGet.mockRejectedValue(new Error("Firestore down"));
      expect(await service.getPreferences("user-1")).toEqual({
        email: true,
        sms: true,
        push: true,
      });
    });
  });

  describe("sendToUser", () => {
    it("renders the template with the user's preferredLanguage and sends", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "test@example.com", preferredLanguage: "en" });

      const factory = vi.fn(stubTemplate);
      await service.sendToUser("user-1", factory, "transactional");

      expect(factory).toHaveBeenCalledWith("en");
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "test@example.com",
          subject: "Subject en",
          html: "<p>HTML en</p>",
          text: "Text en",
          from: "Teranga Events <no-reply@terangaevent.com>",
          replyTo: "support@terangaevent.com",
          tags: expect.arrayContaining([{ name: "category", value: "transactional" }]),
        }),
      );
    });

    it("falls back to French when preferredLanguage is missing", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      const factory = vi.fn(stubTemplate);
      await service.sendToUser("user-1", factory, "transactional");

      expect(factory).toHaveBeenCalledWith("fr");
    });

    it("falls back to French when preferredLanguage is an unknown value", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "test@example.com", preferredLanguage: "es" });

      const factory = vi.fn(stubTemplate);
      await service.sendToUser("user-1", factory, "transactional");

      expect(factory).toHaveBeenCalledWith("fr");
    });

    it("routes billing category to billing@ sender and reply-to", async () => {
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "billing");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Teranga Events <billing@terangaevent.com>",
          replyTo: "billing@terangaevent.com",
        }),
      );
    });

    it("stamps List-Unsubscribe header on marketing category", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "marketing");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Teranga Events <news@terangaevent.com>",
          headers: expect.objectContaining({
            "List-Unsubscribe": expect.stringContaining("mailto:unsubscribe@terangaevent.com"),
          }),
        }),
      );
    });

    it("does NOT send email when user has email disabled (transactional)", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, sms: true, push: true }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "transactional");

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("STILL sends billing email when user has email disabled (mandatory)", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, sms: true, push: true }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "billing");

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockPrefsGet).not.toHaveBeenCalled();
    });

    it("STILL sends auth email when user has email disabled (mandatory)", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, sms: true, push: true }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "auth");

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockPrefsGet).not.toHaveBeenCalled();
    });

    it("does NOT send email when user has no email address", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: null });
      await service.sendToUser("user-1", stubTemplate, "transactional");
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("does NOT send email when user not found", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue(null);
      await service.sendToUser("user-1", stubTemplate, "transactional");
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("merges extra tags with the category tag and forwards idempotencyKey", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "transactional", {
        tags: [{ name: "type", value: "test" }],
        idempotencyKey: "test-key",
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining([
            { name: "category", value: "transactional" },
            { name: "type", value: "test" },
          ]),
          idempotencyKey: "test-key",
        }),
      );
    });

    it("swallows errors without throwing", async () => {
      mockPrefsGet.mockRejectedValue(new Error("DB error"));
      await expect(
        service.sendToUser("user-1", stubTemplate, "transactional"),
      ).resolves.toBeUndefined();
    });
  });

  describe("sendDirect", () => {
    const marketingEmail = { subject: "Newsletter", html: "<p>News</p>", text: "News" };

    it("stamps marketing sender + List-Unsubscribe and skips preference check", async () => {
      await service.sendDirect("subscriber@example.com", marketingEmail, "marketing");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "subscriber@example.com",
          subject: "Newsletter",
          from: "Teranga Events <news@terangaevent.com>",
          replyTo: "contact@terangaevent.com",
          headers: expect.objectContaining({
            "List-Unsubscribe": expect.stringContaining("mailto:"),
          }),
        }),
      );
      expect(mockPrefsGet).not.toHaveBeenCalled();
      expect(mockUserFindById).not.toHaveBeenCalled();
    });

    it("swallows errors without throwing", async () => {
      mockSend.mockRejectedValue(new Error("Network error"));
      await expect(
        service.sendDirect("test@example.com", marketingEmail, "transactional"),
      ).resolves.toBeUndefined();
    });
  });

  describe("sendBulk", () => {
    it("stamps every email with the category sender + headers before delegating", async () => {
      const emails = [
        { to: "a@test.com", subject: "Test", html: "<p>A</p>" },
        { to: "b@test.com", subject: "Test", html: "<p>B</p>" },
      ];

      const result = await service.sendBulk(emails, "marketing");

      const stamped = mockSendBulk.mock.calls[0][0];
      expect(stamped).toHaveLength(2);
      for (const e of stamped) {
        expect(e.from).toBe("Teranga Events <news@terangaevent.com>");
        expect(e.replyTo).toBe("contact@terangaevent.com");
        expect(e.headers).toMatchObject({
          "List-Unsubscribe": expect.stringContaining("mailto:"),
        });
      }
      expect(result.sent).toBe(2);
    });

    it("returns zero results for empty array", async () => {
      const result = await service.sendBulk([], "marketing");
      expect(mockSendBulk).not.toHaveBeenCalled();
      expect(result).toEqual({ total: 0, sent: 0, failed: 0, results: [] });
    });

    it("returns failure result on error", async () => {
      mockSendBulk.mockRejectedValue(new Error("Batch error"));
      const result = await service.sendBulk(
        [{ to: "a@test.com", subject: "Test", html: "<p>A</p>" }],
        "transactional",
      );
      expect(result.failed).toBe(1);
    });
  });

  describe("template helpers", () => {
    beforeEach(() => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({
        email: "user@test.com",
        displayName: "Test",
        preferredLanguage: "en",
      });
    });

    it("sendRegistrationConfirmation forwards locale + tags + idempotencyKey", async () => {
      await service.sendRegistrationConfirmation("user-1", {
        participantName: "Test",
        eventTitle: "Event",
        eventDate: "2026-04-15",
        eventLocation: "Dakar",
        ticketName: "Standard",
        registrationId: "reg-1",
      });

      expect(mockBuildRegistration).toHaveBeenCalledWith(
        expect.objectContaining({ eventTitle: "Event", locale: "en" }),
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining([
            { name: "category", value: "transactional" },
            { name: "type", value: "registration_confirmation" },
          ]),
          idempotencyKey: "reg-confirm:reg-1",
          from: "Teranga Events <no-reply@terangaevent.com>",
        }),
      );
    });

    it("sendPaymentReceipt uses the billing sender and is mandatory (ignores prefs)", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, sms: true, push: true }),
      });

      await service.sendPaymentReceipt("user-1", {
        participantName: "Test",
        amount: "10 000 XOF",
        eventTitle: "Event",
        receiptId: "pay-1",
        paymentDate: "2026-04-15",
      });

      expect(mockBuildReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ amount: "10 000 XOF", locale: "en" }),
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Teranga Events <billing@terangaevent.com>",
          idempotencyKey: "receipt:pay-1",
        }),
      );
      expect(mockPrefsGet).not.toHaveBeenCalled();
    });

    it("sendWelcomeNewsletter sends direct with marketing sender (no pref check)", async () => {
      await service.sendWelcomeNewsletter("subscriber@test.com");

      expect(mockBuildWelcome).toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "subscriber@test.com",
          from: "Teranga Events <news@terangaevent.com>",
          headers: expect.objectContaining({
            "List-Unsubscribe": expect.stringContaining("mailto:"),
          }),
        }),
      );
      expect(mockPrefsGet).not.toHaveBeenCalled();
    });
  });
});
