import { describe, it, expect, vi, beforeEach } from "vitest";

// Provide a stable config mock before importing the service so the sender
// registry resolves deterministic addresses in every assertion.
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
    API_BASE_URL: "https://api.test.local",
    UNSUBSCRIBE_SECRET: "test-unsub-secret-must-be-at-least-32-chars-xyz",
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
// Suppression lookup — defaults to "not suppressed" for every doc id.
// Tests that want to target a specific email flip `suppressedEmails`
// (a Set of lowercased addresses) instead of mutating the fn itself.
const mockSuppressionGet = vi.fn();
const suppressedEmails = new Set<string>();

vi.mock("@/config/firebase", () => ({
  db: {
    collection: (name: string) => ({
      doc: (id?: string) => ({
        get: name === "emailSuppressions" ? () => mockSuppressionGet(id) : mockPrefsGet,
      }),
    }),
  },
  COLLECTIONS: {
    NOTIFICATION_PREFERENCES: "notificationPreferences",
    EMAIL_SUPPRESSIONS: "emailSuppressions",
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
    suppressedEmails.clear();
    // Per-doc-id suppression check: returns { exists: true } only for
    // addresses that tests explicitly added to `suppressedEmails`.
    mockSuppressionGet.mockImplementation(async (id?: string) => ({
      exists: id !== undefined && suppressedEmails.has(id),
    }));
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
          from: "Teranga Events <events@terangaevent.com>",
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

    it("routes marketing category to news@ sender with a signed List-Unsubscribe header", async () => {
      // Phase 3c.4: every non-mandatory sendToUser stamps a per-recipient
      // List-Unsubscribe header pointing at GET /v1/notifications/unsubscribe
      // with a signed token. Gmail + Apple Mail render that as a native
      // "Unsubscribe" button; Gmail's bulk-sender rules also fire the
      // paired POST (RFC 8058 one-click) when the user confirms.
      // This REPLACES the 3b mailto: stub that pointed at a no-op inbox.
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "marketing");

      const call = mockSend.mock.calls[0][0];
      expect(call).toEqual(
        expect.objectContaining({ from: "Teranga Events <news@terangaevent.com>" }),
      );
      expect(call.headers["List-Unsubscribe"]).toMatch(
        /^<https:\/\/api\.test\.local\/v1\/notifications\/unsubscribe\?token=[^>]+>$/,
      );
      expect(call.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      // Token embeds the category so a token for marketing can't be
      // replayed to unsubscribe from transactional.
      expect(call.headers["List-Unsubscribe"]).toContain(".marketing.");
    });

    it("does NOT send email when user has email disabled (transactional) — legacy kill-switch", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, sms: true, push: true }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "transactional");

      expect(mockSend).not.toHaveBeenCalled();
    });

    // ── Phase 3c.3: per-category email gating ──────────────────────────

    it("does NOT send transactional when emailTransactional=false (even if email=true)", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: true, emailTransactional: false }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "transactional");

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("does NOT send organizational when emailOrganizational=false (other categories still flow)", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: true, emailOrganizational: false }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "organizational");
      expect(mockSend).not.toHaveBeenCalled();

      // Same user, transactional send — still delivered because that
      // category's flag isn't set (falls back to email=true).
      vi.clearAllMocks();
      suppressedEmails.clear();
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: true, emailOrganizational: false }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });
      await service.sendToUser("user-1", stubTemplate, "transactional");
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it("per-category true OVERRIDES legacy email=false", async () => {
      // User toggled the transactional category back on after having
      // hit the legacy kill-switch. Honor the deliberate choice.
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, emailTransactional: true }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "transactional");

      expect(mockSend).toHaveBeenCalledOnce();
    });

    it("per-category undefined falls back to legacy email flag (back-compat)", async () => {
      // Pre-3c.3 doc: only the `email` aggregate exists. Every category
      // inherits its value.
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: true }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "organizational");
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it("mandatory categories (billing) ignore every per-category toggle", async () => {
      mockPrefsGet.mockResolvedValue({
        exists: true,
        data: () => ({ email: false, emailTransactional: false, emailOrganizational: false }),
      });
      mockUserFindById.mockResolvedValue({ email: "test@example.com" });

      await service.sendToUser("user-1", stubTemplate, "billing");

      expect(mockSend).toHaveBeenCalledOnce();
      // Preferences read is deliberately skipped for mandatory categories.
      expect(mockPrefsGet).not.toHaveBeenCalled();
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

    it("skips the send when the address is on the suppression list (transactional)", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "bounced@test.com" });
      suppressedEmails.add("bounced@test.com");

      await service.sendToUser("user-1", stubTemplate, "transactional");

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("skips the send even for mandatory categories when suppressed", async () => {
      // Billing is mandatory (bypasses preferences) but NOT mandatory over
      // suppression — a hard-bounced address cannot receive anything, so
      // retrying burns reputation for zero benefit.
      mockUserFindById.mockResolvedValue({ email: "bounced@test.com" });
      suppressedEmails.add("bounced@test.com");

      await service.sendToUser("user-1", stubTemplate, "billing");

      expect(mockSend).not.toHaveBeenCalled();
    });

    it("fails open when the suppression lookup itself errors", async () => {
      mockPrefsGet.mockResolvedValue({ exists: false });
      mockUserFindById.mockResolvedValue({ email: "ok@test.com" });
      mockSuppressionGet.mockRejectedValueOnce(new Error("Firestore down"));

      await service.sendToUser("user-1", stubTemplate, "transactional");

      // Send proceeds — a transient suppression read failure must not
      // block legitimate emails.
      expect(mockSend).toHaveBeenCalledOnce();
    });
  });

  describe("sendDirect", () => {
    const marketingEmail = { subject: "Newsletter", html: "<p>News</p>", text: "News" };

    it("stamps marketing sender and skips preference check (no manual unsubscribe header)", async () => {
      await service.sendDirect("subscriber@example.com", marketingEmail, "marketing");

      const call = mockSend.mock.calls[0][0];
      expect(call).toEqual(
        expect.objectContaining({
          to: "subscriber@example.com",
          subject: "Newsletter",
          from: "Teranga Events <news@terangaevent.com>",
          replyTo: "contact@terangaevent.com",
        }),
      );
      // Marketing bulk runs through Broadcasts (which injects List-Unsubscribe);
      // single welcome-style sends don't carry it manually.
      expect(call.headers).toBeUndefined();
      expect(mockPrefsGet).not.toHaveBeenCalled();
      expect(mockUserFindById).not.toHaveBeenCalled();
    });

    it("swallows errors without throwing", async () => {
      mockSend.mockRejectedValue(new Error("Network error"));
      await expect(
        service.sendDirect("test@example.com", marketingEmail, "transactional"),
      ).resolves.toBeUndefined();
    });

    it("skips suppressed addresses", async () => {
      suppressedEmails.add("suppressed@test.com");

      await service.sendDirect("suppressed@test.com", marketingEmail, "marketing");

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("sendBulk", () => {
    it("stamps every email with the category sender before delegating", async () => {
      const emails = [
        { to: "a@test.com", subject: "Test", html: "<p>A</p>" },
        { to: "b@test.com", subject: "Test", html: "<p>B</p>" },
      ];

      const result = await service.sendBulk(emails, "transactional");

      const stamped = mockSendBulk.mock.calls[0][0];
      expect(stamped).toHaveLength(2);
      for (const e of stamped) {
        expect(e.from).toBe("Teranga Events <events@terangaevent.com>");
        expect(e.replyTo).toBe("support@terangaevent.com");
        expect(e.tags).toEqual(
          expect.arrayContaining([{ name: "category", value: "transactional" }]),
        );
        // No manual List-Unsubscribe — sendBulk is for transactional fan-out.
        // Marketing bulk MUST go through Broadcasts instead.
        expect(e.headers).toBeUndefined();
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

    it("filters out suppressed recipients before hitting the batch endpoint", async () => {
      suppressedEmails.add("bounced@test.com");
      mockSendBulk.mockResolvedValue({ total: 1, sent: 1, failed: 0, results: [] });

      const result = await service.sendBulk(
        [
          { to: "good@test.com", subject: "s", html: "<p>h</p>" },
          { to: "bounced@test.com", subject: "s", html: "<p>h</p>" },
        ],
        "transactional",
      );

      // Only the non-suppressed email reaches the provider.
      const stamped = mockSendBulk.mock.calls[0][0];
      expect(stamped).toHaveLength(1);
      expect(stamped[0].to).toBe("good@test.com");

      // total preserves the original input size so callers can see how
      // many entered the function (sent + failed + suppressed = total).
      expect(result.total).toBe(2);
      expect(result.sent).toBe(1);
    });

    it("returns early without calling the provider when every recipient is suppressed", async () => {
      suppressedEmails.add("a@test.com");
      suppressedEmails.add("b@test.com");

      const result = await service.sendBulk(
        [
          { to: "a@test.com", subject: "s", html: "<p>h</p>" },
          { to: "b@test.com", subject: "s", html: "<p>h</p>" },
        ],
        "transactional",
      );

      expect(mockSendBulk).not.toHaveBeenCalled();
      expect(result.total).toBe(2);
      expect(result.sent).toBe(0);
      expect(result.results.every((r) => r.error === "suppressed")).toBe(true);
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
          idempotencyKey: "reg-confirm/reg-1",
          from: "Teranga Events <events@terangaevent.com>",
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
          idempotencyKey: "payment-receipt/pay-1",
        }),
      );
      expect(mockPrefsGet).not.toHaveBeenCalled();
    });

    it("sendWelcomeNewsletter sends direct with marketing sender (no pref check)", async () => {
      await service.sendWelcomeNewsletter("subscriber@test.com");

      expect(mockBuildWelcome).toHaveBeenCalled();
      const call = mockSend.mock.calls[0][0];
      expect(call).toEqual(
        expect.objectContaining({
          to: "subscriber@test.com",
          from: "Teranga Events <news@terangaevent.com>",
        }),
      );
      expect(call.headers).toBeUndefined();
      expect(mockPrefsGet).not.toHaveBeenCalled();
    });
  });
});
