import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("ResendEmailProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends email successfully via Resend API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "re_msg_123abc" }),
    });

    const { ResendEmailProvider } = await import("../resend-email.provider");
    const provider = new ResendEmailProvider();

    const result = await provider.send({
      to: "participant@example.com",
      subject: "Inscription confirmée — Dakar Tech Summit",
      html: "<p>Votre inscription est confirmée !</p>",
      text: "Votre inscription est confirmée !",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("re_msg_123abc");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("resend.com/emails");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body);
    expect(body.to).toEqual(["participant@example.com"]);
    expect(body.subject).toBe("Inscription confirmée — Dakar Tech Summit");
    expect(body.html).toContain("confirmée");
    expect(body.from).toContain("Teranga Events");
  });

  it("returns failure on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => '{"message":"Missing required field: to"}',
    });

    const { ResendEmailProvider } = await import("../resend-email.provider");
    const provider = new ResendEmailProvider();

    const result = await provider.send({
      to: "",
      subject: "Test",
      html: "<p>Test</p>",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Resend error (422)");
  });

  it("includes attachments in payload (badge PDF)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "re_msg_pdf456" }),
    });

    const { ResendEmailProvider } = await import("../resend-email.provider");
    const provider = new ResendEmailProvider();

    await provider.send({
      to: "participant@example.com",
      subject: "Votre badge",
      html: "<p>Badge en pièce jointe</p>",
      attachments: [
        { filename: "badge-dakar-summit.pdf", content: "JVBERi0xLjQK...", contentType: "application/pdf" },
      ],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].filename).toBe("badge-dakar-summit.pdf");
    expect(body.attachments[0].content_type).toBe("application/pdf");
  });

  it("sends tags for analytics tracking", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "re_msg_tagged" }),
    });

    const { ResendEmailProvider } = await import("../resend-email.provider");
    const provider = new ResendEmailProvider();

    await provider.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Test</p>",
      tags: [
        { name: "category", value: "registration_confirmation" },
        { name: "event_id", value: "evt_123" },
      ],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tags).toHaveLength(2);
    expect(body.tags[0]).toEqual({ name: "category", value: "registration_confirmation" });
  });

  it("includes idempotency key in headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "re_msg_idemp" }),
    });

    const { ResendEmailProvider } = await import("../resend-email.provider");
    const provider = new ResendEmailProvider();

    await provider.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Test</p>",
      idempotencyKey: "reg_12345_confirmation",
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["Idempotency-Key"]).toBe("reg_12345_confirmation");
  });

  it("supports scheduled sending", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "re_msg_scheduled" }),
    });

    const { ResendEmailProvider } = await import("../resend-email.provider");
    const provider = new ResendEmailProvider();

    const scheduledAt = "2026-04-10T08:00:00Z";
    await provider.send({
      to: "user@example.com",
      subject: "Rappel événement",
      html: "<p>L'événement commence demain !</p>",
      scheduledAt,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.scheduled_at).toBe(scheduledAt);
  });

  it("includes reply-to when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "re_msg_reply" }),
    });

    const { ResendEmailProvider } = await import("../resend-email.provider");
    const provider = new ResendEmailProvider();

    await provider.send({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Test</p>",
      replyTo: "organizer@dakar-event.sn",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reply_to).toBe("organizer@dakar-event.sn");
  });

  // ─── Batch Sending ──────────────────────────────────────────────────────────

  it("sends batch emails via /emails/batch endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "re_batch_1" },
          { id: "re_batch_2" },
          { id: "re_batch_3" },
        ],
      }),
    });

    const { ResendEmailProvider } = await import("../resend-email.provider");
    const provider = new ResendEmailProvider();

    const result = await provider.sendBulk([
      { to: "a@test.com", subject: "A", html: "<p>A</p>" },
      { to: "b@test.com", subject: "B", html: "<p>B</p>" },
      { to: "c@test.com", subject: "C", html: "<p>C</p>" },
    ]);

    expect(result.total).toBe(3);
    expect(result.sent).toBe(3);
    expect(result.failed).toBe(0);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/emails/batch");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toHaveLength(3);
    expect(body[0].to).toEqual(["a@test.com"]);
  });

  it("handles batch failure gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    });

    const { ResendEmailProvider } = await import("../resend-email.provider");
    const provider = new ResendEmailProvider();

    const result = await provider.sendBulk([
      { to: "a@test.com", subject: "A", html: "<p>A</p>" },
      { to: "b@test.com", subject: "B", html: "<p>B</p>" },
    ]);

    expect(result.total).toBe(2);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.results[0].error).toContain("Resend batch error (429)");
  });

  it("handles network error in batch", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

    const { ResendEmailProvider } = await import("../resend-email.provider");
    const provider = new ResendEmailProvider();

    const result = await provider.sendBulk([
      { to: "a@test.com", subject: "A", html: "<p>A</p>" },
    ]);

    expect(result.total).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toBe("Network timeout");
  });
});
