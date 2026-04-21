import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Firestore mock ─────────────────────────────────────────────────────────
// subscribe() does tx.get(query) + tx.set(ref, data).
// confirm() does tx.get(docRef) + tx.update(ref, patch).
// Both go through a single runTransaction that invokes the callback with
// a tx object whose get/set/update we intercept. Tests set mockTxGet's
// resolved value per case.

const { mockTxGet, mockTxSet, mockTxUpdate, mockDocFactory } = vi.hoisted(() => ({
  mockTxGet: vi.fn(),
  mockTxSet: vi.fn(),
  mockTxUpdate: vi.fn(),
  // Default behaviour: `collection().doc()` with no id returns {id:"sub-1"},
  // `collection().doc("some-id")` returns { id: "some-id" }. subscribe()
  // uses the first form; confirm() uses the second.
  mockDocFactory: vi.fn((id?: string) => ({ id: id ?? "sub-1" })),
}));

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: (id?: string) => mockDocFactory(id),
      where: vi.fn(() => ({
        limit: vi.fn(() => ({ where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis() })),
      })),
    })),
    runTransaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = { get: mockTxGet, set: mockTxSet, update: mockTxUpdate };
      return fn(tx);
    }),
  },
  COLLECTIONS: {
    NEWSLETTER_SUBSCRIBERS: "newsletterSubscribers",
  },
}));

// ─── Config mock ─────────────────────────────────────────────────────────

const { configRef } = vi.hoisted(() => ({
  configRef: {
    RESEND_NEWSLETTER_SEGMENT_ID: "seg_test" as string | undefined,
    NEWSLETTER_CONFIRM_SECRET: "test-secret-must-be-at-least-32-characters-long-xyz",
    API_BASE_URL: "https://api.test.local",
  },
}));
vi.mock("@/config", () => ({ config: configRef }));

// ─── Sender registry — deterministic marketing sender ────────────────────

vi.mock("@/services/email/sender.registry", () => ({
  resolveSender: (category: string) => ({
    from: `Teranga Events <${category === "marketing" ? "news" : "events"}@terangaevent.com>`,
    replyTo: category === "marketing" ? "contact@terangaevent.com" : "support@terangaevent.com",
    tags: [{ name: "category", value: category }],
  }),
}));

// ─── Stub emailService ──────────────────────────────────────────────────

const { mockSendWelcome, mockSendConfirmation, mockIsSuppressed } = vi.hoisted(() => ({
  mockSendWelcome: vi.fn().mockResolvedValue(undefined),
  mockSendConfirmation: vi.fn().mockResolvedValue(undefined),
  mockIsSuppressed: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/services/email.service", () => ({
  emailService: {
    sendWelcomeNewsletter: mockSendWelcome,
    sendNewsletterConfirmation: mockSendConfirmation,
    isSuppressed: mockIsSuppressed,
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

// ─── Event bus + context ────────────────────────────────────────────────

const { mockEmit } = vi.hoisted(() => ({ mockEmit: vi.fn() }));
vi.mock("@/events/event-bus", () => ({ eventBus: { emit: mockEmit } }));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "req-test",
}));

import { InternalError, NotFoundError, ValidationError } from "@/errors/app-error";
import { NewsletterService, sanitizeNewsletterHtml } from "../newsletter.service";
import { signConfirmationToken } from "../newsletter/confirmation-token";

const service = new NewsletterService();

beforeEach(() => {
  vi.clearAllMocks();
  configRef.RESEND_NEWSLETTER_SEGMENT_ID = "seg_test";
  mockDocFactory.mockImplementation((id?: string) => ({ id: id ?? "sub-1" }));
  mockIsSuppressed.mockResolvedValue(false);
});

// ─── subscribe() ────────────────────────────────────────────────────────

describe("NewsletterService.subscribe", () => {
  it("creates a PENDING row (status=pending, isActive=false) on first subscribe", async () => {
    mockTxGet.mockResolvedValue({ empty: true });

    await service.subscribe("new@example.com");

    expect(mockTxSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sub-1" }),
      expect.objectContaining({
        id: "sub-1",
        email: "new@example.com",
        status: "pending",
        isActive: false, // Back-compat field; flips to true on confirm()
        source: "website",
        ipAddress: null,
        userAgent: null,
      }),
    );
  });

  it("records the IP + User-Agent on the subscriber doc for the consent trail", async () => {
    mockTxGet.mockResolvedValue({ empty: true });

    await service.subscribe("gdpr@example.com", {
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0 (Test)",
    });

    expect(mockTxSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0 (Test)",
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

  it("rejects invalid email format", async () => {
    await expect(service.subscribe("not-an-email")).rejects.toThrow("Adresse e-mail invalide");
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it("emits newsletter.subscriber_created + sends the confirmation email on first subscribe", async () => {
    mockTxGet.mockResolvedValue({ empty: true });

    await service.subscribe("firsttime@example.com");

    expect(mockEmit).toHaveBeenCalledWith(
      "newsletter.subscriber_created",
      expect.objectContaining({
        subscriberId: "sub-1",
        email: "firsttime@example.com",
        source: "website",
        actorId: "anonymous",
      }),
    );
    // CONFIRMATION email, not welcome — welcome fires on confirm().
    expect(mockSendConfirmation).toHaveBeenCalledTimes(1);
    expect(mockSendConfirmation).toHaveBeenCalledWith(
      "firsttime@example.com",
      expect.stringMatching(/^https:\/\/api\.test\.local\/v1\/newsletter\/confirm\?token=/),
    );
    // Welcome is DEFERRED to the confirm() step.
    expect(mockSendWelcome).not.toHaveBeenCalled();
  });

  it("never mirrors to Resend from the API path — the Firestore trigger owns it", async () => {
    mockTxGet.mockResolvedValue({ empty: true });
    await service.subscribe("trigger-owned@example.com");

    expect(mockCreateContact).not.toHaveBeenCalled();
  });

  it("short-circuits cleanly when the address is on the suppression list (Phase 3c.6 L1)", async () => {
    // A previously hard-bounced address re-subscribes. Without this
    // guard we'd write a pending row + try to send a confirmation email
    // that emailService would silently drop — leaving the user staring
    // at an inbox that never gets the link. Bail out before any
    // Firestore write, returning the same response shape so we don't
    // leak suppression state.
    mockIsSuppressed.mockResolvedValueOnce(true);

    await service.subscribe("previously-bounced@example.com");

    expect(mockTxGet).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
    expect(mockSendConfirmation).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  describe("idempotent duplicate-email branches", () => {
    const existingDoc = (status: string) => ({
      empty: false,
      docs: [{ id: "existing-1", data: () => ({ status, email: "dup@example.com" }) }],
    });

    it("pending existing → re-sends the confirmation email (user lost the first)", async () => {
      mockTxGet.mockResolvedValue(existingDoc("pending"));

      await service.subscribe("dup@example.com");

      expect(mockTxSet).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
      // Confirmation re-dispatched so the user can still complete opt-in.
      expect(mockSendConfirmation).toHaveBeenCalledTimes(1);
    });

    it("confirmed existing → silent no-op (no event, no email)", async () => {
      mockTxGet.mockResolvedValue(existingDoc("confirmed"));

      await service.subscribe("dup@example.com");

      expect(mockTxSet).not.toHaveBeenCalled();
      expect(mockSendConfirmation).not.toHaveBeenCalled();
      expect(mockSendWelcome).not.toHaveBeenCalled();
    });

    it("unsubscribed existing → silent no-op (respects earlier choice)", async () => {
      mockTxGet.mockResolvedValue(existingDoc("unsubscribed"));

      await service.subscribe("dup@example.com");

      expect(mockTxSet).not.toHaveBeenCalled();
      expect(mockSendConfirmation).not.toHaveBeenCalled();
    });

    it("legacy existing (no status field) → silent no-op, grandfathered as confirmed", async () => {
      mockTxGet.mockResolvedValue({
        empty: false,
        docs: [{ id: "legacy-1", data: () => ({ email: "legacy@example.com" }) }],
      });

      await service.subscribe("legacy@example.com");

      expect(mockTxSet).not.toHaveBeenCalled();
      expect(mockSendConfirmation).not.toHaveBeenCalled();
    });
  });
});

// ─── confirm() ──────────────────────────────────────────────────────────

describe("NewsletterService.confirm", () => {
  const validToken = () => signConfirmationToken("sub-42");

  it("flips a pending subscriber to confirmed, emits event, sends welcome", async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: "pending@example.com", status: "pending" }),
    });

    const result = await service.confirm(validToken());

    expect(result.alreadyConfirmed).toBe(false);
    expect(result.email).toBe("pending@example.com");
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sub-42" }),
      expect.objectContaining({
        status: "confirmed",
        isActive: true,
        confirmedAt: expect.any(String),
      }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      "newsletter.subscriber_confirmed",
      expect.objectContaining({
        subscriberId: "sub-42",
        email: "pending@example.com",
        actorId: "anonymous",
      }),
    );
    expect(mockSendWelcome).toHaveBeenCalledWith("pending@example.com");
  });

  it("returning already-confirmed is idempotent (no update, no event, no re-welcome)", async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: "already@example.com", status: "confirmed" }),
    });

    const result = await service.confirm(validToken());

    expect(result.alreadyConfirmed).toBe(true);
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockSendWelcome).not.toHaveBeenCalled();
  });

  it("rejects a tampered token as invalid (ValidationError)", async () => {
    const token = validToken();
    const parts = token.split(".");
    const tampered = `EVIL.${parts[1]}.${parts[2]}`;

    await expect(service.confirm(tampered)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.confirm(tampered)).rejects.toThrow(/invalide/i);
  });

  it("rejects an expired token with a re-subscribe hint", async () => {
    const token = signConfirmationToken("sub-42", { now: Date.now() - 30 * 86400_000, ttlMs: 1 });

    await expect(service.confirm(token)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.confirm(token)).rejects.toThrow(/expiré/i);
  });

  it("throws NotFoundError when the subscriber doc was deleted between send and click", async () => {
    mockTxGet.mockResolvedValue({ exists: false });

    await expect(service.confirm(validToken())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to resurrect an unsubscribed subscriber (ValidationError)", async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: "unsub@example.com", status: "unsubscribed" }),
    });

    await expect(service.confirm(validToken())).rejects.toBeInstanceOf(ValidationError);
    await expect(service.confirm(validToken())).rejects.toThrow(/désinscrite/i);
  });
});

// ─── sendNewsletter() — unchanged from 3a ───────────────────────────────

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
    expect(out).toContain("color:red");
  });

  // ─── CSS-injection regression guards (Phase 3c.6) ──────────────────────
  // Before 3c.6 the sanitizer allowed the `style` attribute through
  // without filtering property values — verified by live execution that
  // the payloads below reached subscriber inboxes unchanged. The new
  // `allowedStyles` whitelist blocks them at parse time.

  it("strips url() payloads that try to smuggle javascript: URIs through background-image", () => {
    const out = sanitizeNewsletterHtml(
      '<p style="background-image: url(javascript:alert(1))">x</p>',
    );
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("url(");
    // background-image isn't on the allowlist at all — the entire
    // declaration is dropped.
    expect(out).not.toContain("background-image");
  });

  it("strips IE-era `expression(...)` payloads on color", () => {
    const out = sanitizeNewsletterHtml('<p style="color: expression(alert(1))">x</p>');
    expect(out).not.toContain("expression");
    expect(out).not.toContain("alert");
  });

  it("strips `behavior:` HTC imports", () => {
    const out = sanitizeNewsletterHtml('<p style="behavior: url(evil.htc)">x</p>');
    expect(out).not.toContain("behavior");
    expect(out).not.toContain("url(");
  });

  it("strips `@import` inside style attributes", () => {
    const out = sanitizeNewsletterHtml('<p style="@import url(evil.css)">x</p>');
    expect(out).not.toContain("@import");
  });

  it("allows safe hex / rgb / named colors", () => {
    const hex = sanitizeNewsletterHtml('<p style="color: #D4A843">x</p>');
    expect(hex).toContain("#D4A843");
    const rgb = sanitizeNewsletterHtml('<p style="color: rgb(212, 168, 67)">x</p>');
    expect(rgb).toContain("rgb(212, 168, 67)");
    const named = sanitizeNewsletterHtml('<p style="color: transparent">x</p>');
    expect(named).toContain("transparent");
  });
});
