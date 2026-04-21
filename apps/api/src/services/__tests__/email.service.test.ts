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

import { EmailService } from "../email.service";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSend = vi.fn().mockResolvedValue({ success: true, messageId: "msg-1" });
const mockSendBulk = vi.fn().mockResolvedValue({ total: 2, sent: 2, failed: 0, results: [] });

vi.mock("@/providers/index", () => ({
  getEmailProvider: () => ({
    name: "mock",
    send: mockSend,
    sendBulk: mockSendBulk,
  }),
  buildRegistrationEmail: vi.fn().mockReturnValue({
    subject: "Inscription confirmée",
    html: "<p>Confirmed</p>",
    text: "Confirmed",
  }),
  buildRegistrationApprovedEmail: vi.fn().mockReturnValue({
    subject: "Inscription approuvée",
    html: "<p>Approved</p>",
    text: "Approved",
  }),
  buildBadgeReadyEmail: vi.fn().mockReturnValue({
    subject: "Badge prêt",
    html: "<p>Badge</p>",
    text: "Badge",
  }),
  buildEventCancelledEmail: vi.fn().mockReturnValue({
    subject: "Événement annulé",
    html: "<p>Cancelled</p>",
    text: "Cancelled",
  }),
  buildEventReminderEmail: vi.fn().mockReturnValue({
    subject: "Rappel",
    html: "<p>Reminder</p>",
    text: "Reminder",
  }),
  buildWelcomeEmail: vi.fn().mockReturnValue({
    subject: "Bienvenue",
    html: "<p>Welcome</p>",
    text: "Welcome",
  }),
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

      const prefs = await service.getPreferences("user-1");
      expect(prefs).toEqual({ email: true, sms: true, push: true });
    });

    it("returns stored preferences when document exists", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, sms: true, push: false }),
      });

      const prefs = await service.getPreferences("user-1");
      expect(prefs).toEqual({ email: false, sms: true, push: false });
    });

    it("returns defaults on error", async () => {
      mockPrefsGet.mockRejectedValue(new Error("Firestore down"));

      const prefs = await service.getPreferences("user-1");
      expect(prefs).toEqual({ email: true, sms: true, push: true });
    });
  });

  describe("sendToUser", () => {
    const emailContent = { subject: "Test", html: "<p>Test</p>", text: "Test" };

    it("sends email when user has email enabled (default prefs)", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false }); // defaults: email=true
      mockUserFindById.mockResolvedValue({ email: "test@example.com", displayName: "Test" });

      await service.sendToUser("user-1", emailContent, "transactional");

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "test@example.com",
          subject: "Test",
          html: "<p>Test</p>",
          text: "Test",
          from: "Teranga Events <no-reply@terangaevent.com>",
          replyTo: "support@terangaevent.com",
          tags: expect.arrayContaining([{ name: "category", value: "transactional" }]),
        }),
      );
    });

    it("routes billing category to billing@ sender and reply-to", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", emailContent, "billing");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Teranga Events <billing@terangaevent.com>",
          replyTo: "billing@terangaevent.com",
          tags: expect.arrayContaining([{ name: "category", value: "billing" }]),
        }),
      );
    });

    it("routes marketing category to news@ sender and contact@ reply-to", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", emailContent, "marketing");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Teranga Events <news@terangaevent.com>",
          replyTo: "contact@terangaevent.com",
          tags: expect.arrayContaining([{ name: "category", value: "marketing" }]),
        }),
      );
    });

    it("does NOT send email when user has email disabled (transactional)", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, sms: true, push: true }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", emailContent, "transactional");

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("STILL sends billing email when user has email disabled (mandatory)", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, sms: true, push: true }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", emailContent, "billing");

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "test@example.com",
          from: "Teranga Events <billing@terangaevent.com>",
        }),
      );
      // Preferences are not fetched for mandatory categories — skip the DB read.
      expect(mockPrefsGet).not.toHaveBeenCalled();
    });

    it("STILL sends auth email when user has email disabled (mandatory)", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, sms: true, push: true }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", emailContent, "auth");

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockPrefsGet).not.toHaveBeenCalled();
    });

    it("does NOT send email when user has no email address", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: null, displayName: "No Email" });

      await service.sendToUser("user-1", emailContent, "transactional");

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("does NOT send email when user not found", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue(null);

      await service.sendToUser("user-1", emailContent, "transactional");

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("merges extra tags with the category tag and forwards idempotencyKey", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", emailContent, "transactional", {
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

      // Should not throw
      await expect(
        service.sendToUser("user-1", emailContent, "transactional"),
      ).resolves.toBeUndefined();
    });
  });

  describe("sendDirect", () => {
    it("sends email directly without preference check and stamps marketing sender", async () => {
      await service.sendDirect(
        "subscriber@example.com",
        {
          subject: "Newsletter",
          html: "<p>News</p>",
          text: "News",
        },
        "marketing",
      );

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "subscriber@example.com",
          subject: "Newsletter",
          from: "Teranga Events <news@terangaevent.com>",
          replyTo: "contact@terangaevent.com",
        }),
      );
      // No preference check
      expect(mockPrefsGet).not.toHaveBeenCalled();
      expect(mockUserFindById).not.toHaveBeenCalled();
    });

    it("swallows errors without throwing", async () => {
      mockSend.mockRejectedValue(new Error("Network error"));

      await expect(
        service.sendDirect(
          "test@example.com",
          {
            subject: "Test",
            html: "<p>Test</p>",
            text: "Test",
          },
          "transactional",
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("sendBulk", () => {
    it("stamps every email with the category sender before delegating to provider", async () => {
      const emails = [
        { to: "a@test.com", subject: "Test", html: "<p>A</p>" },
        { to: "b@test.com", subject: "Test", html: "<p>B</p>" },
      ];

      const result = await service.sendBulk(emails, "marketing");

      expect(mockSendBulk).toHaveBeenCalledOnce();
      const stamped = mockSendBulk.mock.calls[0][0];
      expect(stamped).toHaveLength(2);
      for (const e of stamped) {
        expect(e.from).toBe("Teranga Events <news@terangaevent.com>");
        expect(e.replyTo).toBe("contact@terangaevent.com");
        expect(e.tags).toEqual(expect.arrayContaining([{ name: "category", value: "marketing" }]));
      }
      expect(result.total).toBe(2);
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

      expect(result.total).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.sent).toBe(0);
    });
  });

  describe("template helpers", () => {
    beforeEach(() => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "user@test.com", displayName: "Test" });
    });

    it("sendRegistrationConfirmation sends with correct tags (category + type)", async () => {
      await service.sendRegistrationConfirmation("user-1", {
        participantName: "Test",
        eventTitle: "Event",
        eventDate: "2026-04-15",
        eventLocation: "Dakar",
        ticketName: "Standard",
        registrationId: "reg-1",
      });

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

    it("sendRegistrationApproved sends email", async () => {
      await service.sendRegistrationApproved("user-1", {
        participantName: "Test",
        eventTitle: "Event",
        eventDate: "2026-04-15",
        eventLocation: "Dakar",
      });

      expect(mockSend).toHaveBeenCalledOnce();
    });

    it("sendBadgeReady sends email", async () => {
      await service.sendBadgeReady("user-1", {
        participantName: "Test",
        eventTitle: "Event",
      });

      expect(mockSend).toHaveBeenCalledOnce();
    });

    it("sendEventCancelled sends email", async () => {
      await service.sendEventCancelled("user-1", {
        participantName: "Test",
        eventTitle: "Event",
        eventDate: "2026-04-15",
      });

      expect(mockSend).toHaveBeenCalledOnce();
    });

    it("sendWelcomeNewsletter sends direct (no preference check)", async () => {
      await service.sendWelcomeNewsletter("subscriber@test.com");

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockPrefsGet).not.toHaveBeenCalled();
    });
  });
});
