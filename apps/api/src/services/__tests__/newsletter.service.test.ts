import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Firestore mock ─────────────────────────────────────────────────────────
// `subscribe` now runs inside db.runTransaction(). The mock models that:
// `runTransaction(fn)` just invokes the callback with a tx object that
// forwards reads to mockTxGet and records writes on mockTxSet.

const { mockTxGet, mockTxSet, mockDocFactory } = vi.hoisted(() => ({
  mockTxGet: vi.fn(),
  mockTxSet: vi.fn(),
  mockDocFactory: vi.fn(() => ({ id: "sub-1" })),
}));

const makeQuery = () => ({ where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis() });

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: () => mockDocFactory(),
      where: vi.fn(() => ({
        limit: vi.fn(() => makeQuery()),
      })),
    })),
    runTransaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = { get: mockTxGet, set: mockTxSet };
      return fn(tx);
    }),
  },
  COLLECTIONS: {
    NEWSLETTER_SUBSCRIBERS: "newsletterSubscribers",
  },
}));

// ─── Config mock — controls segment id for each test ─────────────────────

const { configRef } = vi.hoisted(() => ({
  configRef: { RESEND_NEWSLETTER_SEGMENT_ID: "seg_test" as string | undefined },
}));
vi.mock("@/config", () => ({ config: configRef }));

// ─── Sender registry — deterministic marketing sender ────────────────────

vi.mock("@/services/email/sender.registry", () => ({
  resolveSender: (category: string) => ({
    from: `Teranga Events <${category === "marketing" ? "news" : "no-reply"}@terangaevent.com>`,
    replyTo: category === "marketing" ? "contact@terangaevent.com" : "support@terangaevent.com",
    tags: [{ name: "category", value: category }],
  }),
}));

// ─── Stub emailService so we don't pull react-email into this unit ──────

const { mockSendWelcome } = vi.hoisted(() => ({
  mockSendWelcome: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/email.service", () => ({
  emailService: {
    sendWelcomeNewsletter: mockSendWelcome,
  },
}));

// ─── Resend provider stubs ──────────────────────────────────────────────

const { mockCreateContact, mockCreateAndSendBroadcast } = vi.hoisted(() => ({
  mockCreateContact: vi.fn().mockResolvedValue({ success: true, contactId: "cont_1" }),
  mockCreateAndSendBroadcast: vi.fn().mockResolvedValue({ success: true, broadcastId: "bc_1" }),
}));
vi.mock("@/providers/resend-email.provider", () => ({
  resendEmailProvider: {
    createContact: mockCreateContact,
    createAndSendBroadcast: mockCreateAndSendBroadcast,
  },
}));

// ─── Event bus spy ──────────────────────────────────────────────────────

const { mockEmit } = vi.hoisted(() => ({ mockEmit: vi.fn() }));
vi.mock("@/events/event-bus", () => ({ eventBus: { emit: mockEmit } }));

// ─── Context — stable request id ────────────────────────────────────────

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "req-test",
}));

import { InternalError, ValidationError } from "@/errors/app-error";
import { NewsletterService, sanitizeNewsletterHtml } from "../newsletter.service";

const flushPromises = () => new Promise((r) => setImmediate(r));

const service = new NewsletterService();

beforeEach(() => {
  vi.clearAllMocks();
  configRef.RESEND_NEWSLETTER_SEGMENT_ID = "seg_test";
  mockDocFactory.mockReturnValue({ id: "sub-1" });
});

describe("NewsletterService.subscribe", () => {
  it("creates a new subscriber in a transaction when email is not yet subscribed", async () => {
    mockTxGet.mockResolvedValue({ empty: true });

    await service.subscribe("new@example.com");

    expect(mockTxSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sub-1" }),
      expect.objectContaining({
        id: "sub-1",
        email: "new@example.com",
        isActive: true,
        source: "website",
      }),
    );
  });

  it("normalizes email to lowercase before writing", async () => {
    mockTxGet.mockResolvedValue({ empty: true });
    await service.subscribe("Test@Example.COM");
    expect(mockTxSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: "test@example.com" }),
    );
  });

  it("returns silently for duplicate subscriptions (idempotent)", async () => {
    mockTxGet.mockResolvedValue({ empty: false, docs: [{ id: "existing" }] });
    await service.subscribe("existing@example.com");
    expect(mockTxSet).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockCreateContact).not.toHaveBeenCalled();
  });

  it("rejects invalid email format", async () => {
    await expect(service.subscribe("not-an-email")).rejects.toThrow("Adresse e-mail invalide");
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it("emits newsletter.subscriber_created after a successful create", async () => {
    mockTxGet.mockResolvedValue({ empty: true });
    await service.subscribe("newsub@example.com");

    expect(mockEmit).toHaveBeenCalledWith(
      "newsletter.subscriber_created",
      expect.objectContaining({
        subscriberId: "sub-1",
        email: "newsub@example.com",
        source: "website",
        actorId: "anonymous",
        requestId: "req-test",
      }),
    );
  });

  it("mirrors the subscriber into the Resend segment when SEGMENT_ID is configured", async () => {
    mockTxGet.mockResolvedValue({ empty: true });
    await service.subscribe("mirror@example.com");
    await flushPromises();

    expect(mockCreateContact).toHaveBeenCalledWith("seg_test", { email: "mirror@example.com" });
  });

  it("skips the Resend mirror when SEGMENT_ID is not configured", async () => {
    configRef.RESEND_NEWSLETTER_SEGMENT_ID = undefined;
    mockTxGet.mockResolvedValue({ empty: true });

    await service.subscribe("no-segment@example.com");
    await flushPromises();

    expect(mockTxSet).toHaveBeenCalledOnce();
    expect(mockCreateContact).not.toHaveBeenCalled();
  });

  it("completes the subscribe flow even if the Resend mirror fails", async () => {
    mockTxGet.mockResolvedValue({ empty: true });
    mockCreateContact.mockRejectedValueOnce(new Error("Resend 500"));

    await expect(service.subscribe("resilient@example.com")).resolves.toBeUndefined();
    expect(mockTxSet).toHaveBeenCalled();
    expect(mockSendWelcome).toHaveBeenCalledWith("resilient@example.com");
  });
});

describe("NewsletterService.sendNewsletter", () => {
  it("creates and sends a broadcast with sanitized HTML + unsubscribe placeholder", async () => {
    const result = await service.sendNewsletter({
      subject: "Teranga news — avril",
      htmlBody: "<h2>Nouvelles</h2><p>Contenu.</p>",
      textBody: "Nouvelles. Contenu.",
      actorUserId: "admin-1",
    });

    expect(mockCreateAndSendBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentId: "seg_test",
        from: "Teranga Events <news@terangaevent.com>",
        replyTo: "contact@terangaevent.com",
        subject: "Teranga news — avril",
        text: "Nouvelles. Contenu.",
        name: "Teranga news — avril",
      }),
    );
    const payload = mockCreateAndSendBroadcast.mock.calls[0][0];
    expect(payload.html).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(payload.html).toContain("Nouvelles");
    expect(result).toEqual({ broadcastId: "bc_1" });
  });

  it("emits newsletter.sent with actor + broadcast id on success", async () => {
    await service.sendNewsletter({
      subject: "Hello",
      htmlBody: "<p>body</p>",
      actorUserId: "admin-42",
    });

    expect(mockEmit).toHaveBeenCalledWith(
      "newsletter.sent",
      expect.objectContaining({
        broadcastId: "bc_1",
        subject: "Hello",
        segmentId: "seg_test",
        actorId: "admin-42",
      }),
    );
  });

  it("strips <script> tags from admin-supplied HTML before sending", async () => {
    await service.sendNewsletter({
      subject: "xss-try",
      htmlBody: '<p>safe</p><script>alert(1)</script><img src="javascript:bad">',
      actorUserId: "admin-1",
    });

    const payload = mockCreateAndSendBroadcast.mock.calls[0][0];
    expect(payload.html).not.toContain("<script");
    expect(payload.html).not.toContain("alert(1)");
    expect(payload.html).not.toContain("javascript:");
    expect(payload.html).toContain("<p>safe</p>");
  });

  it("rejects when sanitization empties the body", async () => {
    await expect(
      service.sendNewsletter({
        subject: "empty",
        htmlBody: "<script>only-bad</script><iframe></iframe>",
        actorUserId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockCreateAndSendBroadcast).not.toHaveBeenCalled();
  });

  it("no-ops when SEGMENT_ID is not configured", async () => {
    configRef.RESEND_NEWSLETTER_SEGMENT_ID = undefined;

    const result = await service.sendNewsletter({
      subject: "x",
      htmlBody: "<p>y</p>",
      actorUserId: "admin-1",
    });

    expect(mockCreateAndSendBroadcast).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("RESEND_NEWSLETTER_SEGMENT_ID");
  });

  it("throws InternalError (not raw Resend message) when Resend rejects", async () => {
    mockCreateAndSendBroadcast.mockResolvedValueOnce({
      success: false,
      error: "Resend validation_error: segmentId required",
    });

    const promise = service.sendNewsletter({
      subject: "s",
      htmlBody: "<p>h</p>",
      actorUserId: "admin-1",
    });

    await expect(promise).rejects.toBeInstanceOf(InternalError);
    // User-facing message must be generic — Resend internal detail stays
    // in stderr (operator log) only.
    await expect(promise).rejects.toThrow(/newsletter/i);
    await expect(promise).rejects.not.toThrow(/segmentId/);
  });
});

describe("sanitizeNewsletterHtml (standalone)", () => {
  it("keeps the Resend unsubscribe link intact", () => {
    const out = sanitizeNewsletterHtml(
      '<p>Click <a href="{{{RESEND_UNSUBSCRIBE_URL}}}">here</a></p>',
    );
    expect(out).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(out).toContain("<a");
  });

  it("drops inline event handlers", () => {
    const out = sanitizeNewsletterHtml('<p onclick="alert(1)">hi</p>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("<p>hi</p>");
  });

  it("drops javascript: and data: URIs on anchors", () => {
    const out = sanitizeNewsletterHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  it("preserves inline styles for email-client compatibility", () => {
    const out = sanitizeNewsletterHtml('<p style="color:red">x</p>');
    expect(out).toContain('style="color:red"');
  });
});
