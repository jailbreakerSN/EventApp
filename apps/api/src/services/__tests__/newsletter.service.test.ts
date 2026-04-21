import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockDocSet = vi.fn().mockResolvedValue(undefined);
const mockDocRef = { id: "sub-1", set: mockDocSet };
const mockWhereGet = vi.fn();

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => mockDocRef),
      where: vi.fn(() => ({
        limit: vi.fn(() => ({ get: mockWhereGet })),
      })),
    })),
  },
  COLLECTIONS: {
    NEWSLETTER_SUBSCRIBERS: "newsletterSubscribers",
  },
}));

// Config mock — segment id controls whether the service mirrors to Resend.
const { configRef } = vi.hoisted(() => ({
  configRef: { RESEND_NEWSLETTER_SEGMENT_ID: "seg_test" },
}));
vi.mock("@/config", () => ({ config: configRef }));

// Stub emailService so we don't drag react-email rendering into this unit test.
const { mockSendWelcome } = vi.hoisted(() => ({
  mockSendWelcome: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/email.service", () => ({
  emailService: {
    sendWelcomeNewsletter: mockSendWelcome,
  },
}));

// Sender registry — deterministic marketing sender for broadcast assertions.
vi.mock("@/services/email/sender.registry", () => ({
  resolveSender: (category: string) => ({
    from: `Teranga Events <${category === "marketing" ? "news" : "no-reply"}@terangaevent.com>`,
    replyTo: category === "marketing" ? "contact@terangaevent.com" : "support@terangaevent.com",
    tags: [{ name: "category", value: category }],
  }),
}));

// Resend provider — stub createContact + createAndSendBroadcast so the
// newsletter service can be tested without the real SDK.
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

import { NewsletterService } from "../newsletter.service";

// Helper to wait for fire-and-forget mirrorToSegment to drain.
const flushPromises = () => new Promise((r) => setImmediate(r));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new NewsletterService();

beforeEach(() => {
  vi.clearAllMocks();
  configRef.RESEND_NEWSLETTER_SEGMENT_ID = "seg_test";
});

describe("NewsletterService.subscribe", () => {
  it("creates a new subscriber in Firestore", async () => {
    mockWhereGet.mockResolvedValue({ empty: true });

    await service.subscribe("new@example.com");

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sub-1",
        email: "new@example.com",
        isActive: true,
        source: "website",
      }),
    );
  });

  it("normalizes email to lowercase", async () => {
    mockWhereGet.mockResolvedValue({ empty: true });
    await service.subscribe("Test@Example.COM");
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({ email: "test@example.com" }));
  });

  it("returns silently for duplicate subscriptions (idempotent)", async () => {
    mockWhereGet.mockResolvedValue({ empty: false, docs: [{ id: "existing" }] });
    await service.subscribe("existing@example.com");
    expect(mockDocSet).not.toHaveBeenCalled();
    expect(mockCreateContact).not.toHaveBeenCalled();
  });

  it("rejects invalid email format", async () => {
    await expect(service.subscribe("not-an-email")).rejects.toThrow("Adresse e-mail invalide");
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  it("mirrors the subscriber into the Resend segment when SEGMENT_ID is configured", async () => {
    mockWhereGet.mockResolvedValue({ empty: true });
    await service.subscribe("mirror@example.com");
    await flushPromises();

    expect(mockCreateContact).toHaveBeenCalledWith("seg_test", { email: "mirror@example.com" });
  });

  it("skips the Resend mirror when SEGMENT_ID is not configured", async () => {
    configRef.RESEND_NEWSLETTER_SEGMENT_ID = undefined as unknown as string;
    mockWhereGet.mockResolvedValue({ empty: true });

    await service.subscribe("no-segment@example.com");
    await flushPromises();

    expect(mockDocSet).toHaveBeenCalledOnce();
    expect(mockCreateContact).not.toHaveBeenCalled();
  });

  it("completes the subscribe flow even if the Resend mirror fails", async () => {
    mockWhereGet.mockResolvedValue({ empty: true });
    mockCreateContact.mockRejectedValueOnce(new Error("Resend 500"));

    // Must not throw — subscribe is user-facing.
    await expect(service.subscribe("resilient@example.com")).resolves.toBeUndefined();
    expect(mockDocSet).toHaveBeenCalled();
    expect(mockSendWelcome).toHaveBeenCalledWith("resilient@example.com");
  });
});

describe("NewsletterService.sendNewsletter", () => {
  it("creates and sends a broadcast against the configured segment", async () => {
    const result = await service.sendNewsletter(
      "Teranga news — avril",
      "<h2>Nouvelles</h2><p>Contenu.</p>",
      "Nouvelles. Contenu.",
    );

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
    // HTML must contain the Resend unsubscribe placeholder — that's what
    // Resend substitutes per-recipient at send time.
    const payload = mockCreateAndSendBroadcast.mock.calls[0][0];
    expect(payload.html).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(payload.html).toContain("Nouvelles");
    expect(result).toEqual({ broadcastId: "bc_1" });
  });

  it("no-ops when SEGMENT_ID is not configured", async () => {
    configRef.RESEND_NEWSLETTER_SEGMENT_ID = undefined as unknown as string;

    const result = await service.sendNewsletter("Subject", "<p>Body</p>");

    expect(mockCreateAndSendBroadcast).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("RESEND_NEWSLETTER_SEGMENT_ID");
  });

  it("throws when Resend rejects the broadcast", async () => {
    mockCreateAndSendBroadcast.mockResolvedValueOnce({
      success: false,
      error: "Resend validation_error: missing from",
    });

    await expect(service.sendNewsletter("s", "<p>h</p>")).rejects.toThrow(
      "Resend validation_error: missing from",
    );
  });
});
