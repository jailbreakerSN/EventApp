import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock fetch globally ────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Africa's Talking SMS ───────────────────────────────────────────────────

describe("AfricasTalkingSmsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends SMS successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        SMSMessageData: {
          Message: "Sent to 1/1",
          Recipients: [
            {
              statusCode: 101,
              number: "+221771234567",
              status: "Success",
              messageId: "ATXid_123",
            },
          ],
        },
      }),
    });

    const { AfricasTalkingSmsProvider } = await import("../africastalking-sms.provider");
    const provider = new AfricasTalkingSmsProvider();

    const result = await provider.send("+221771234567", "Test SMS");
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("ATXid_123");
  });

  it("returns failure on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const { AfricasTalkingSmsProvider } = await import("../africastalking-sms.provider");
    const provider = new AfricasTalkingSmsProvider();

    const result = await provider.send("+221771234567", "Test");
    expect(result.success).toBe(false);
    expect(result.error).toContain("AT API error");
  });

  it("handles recipient failure status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        SMSMessageData: {
          Message: "Sent to 0/1",
          Recipients: [
            {
              statusCode: 403,
              number: "+221771234567",
              status: "InvalidPhoneNumber",
              messageId: "",
            },
          ],
        },
      }),
    });

    const { AfricasTalkingSmsProvider } = await import("../africastalking-sms.provider");
    const provider = new AfricasTalkingSmsProvider();

    const result = await provider.send("+221771234567", "Test");
    expect(result.success).toBe(false);
    expect(result.error).toBe("InvalidPhoneNumber");
  });

  it("sends bulk SMS in batches", async () => {
    // Two messages, both succeed
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          SMSMessageData: {
            Message: "Sent to 1/1",
            Recipients: [{ statusCode: 100, number: "+221770000001", status: "Success", messageId: "id1" }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          SMSMessageData: {
            Message: "Sent to 1/1",
            Recipients: [{ statusCode: 100, number: "+221770000002", status: "Success", messageId: "id2" }],
          },
        }),
      });

    const { AfricasTalkingSmsProvider } = await import("../africastalking-sms.provider");
    const provider = new AfricasTalkingSmsProvider();

    const result = await provider.sendBulk([
      { to: "+221770000001", body: "Hello 1" },
      { to: "+221770000002", body: "Hello 2" },
    ]);

    expect(result.total).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
  });
});

// ─── SendGrid Email ─────────────────────────────────────────────────────────

describe("SendGridEmailProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends email successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      headers: new Map([["x-message-id", "sg_msg_123"]]),
    });

    const { SendGridEmailProvider } = await import("../sendgrid-email.provider");
    const provider = new SendGridEmailProvider();

    const result = await provider.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
      text: "Hello",
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("sendgrid.com");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.personalizations[0].to[0].email).toBe("test@example.com");
  });

  it("returns failure on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    const { SendGridEmailProvider } = await import("../sendgrid-email.provider");
    const provider = new SendGridEmailProvider();

    const result = await provider.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("SendGrid error");
  });

  it("includes attachments in payload", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      headers: new Map([["x-message-id", "sg_msg_456"]]),
    });

    const { SendGridEmailProvider } = await import("../sendgrid-email.provider");
    const provider = new SendGridEmailProvider();

    await provider.send({
      to: "test@example.com",
      subject: "Badge",
      html: "<p>Your badge</p>",
      attachments: [
        { filename: "badge.pdf", content: "base64data", contentType: "application/pdf" },
      ],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].filename).toBe("badge.pdf");
  });
});
