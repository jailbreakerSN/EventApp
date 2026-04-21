import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── SDK mocks ──────────────────────────────────────────────────────────────
// vi.hoisted keeps the mocks available when vi.mock is hoisted above imports.

const {
  mockEmailsSend,
  mockBatchSend,
  mockBroadcastsCreate,
  mockContactsCreate,
  mockContactsUpdate,
} = vi.hoisted(() => ({
  mockEmailsSend: vi.fn(),
  mockBatchSend: vi.fn(),
  mockBroadcastsCreate: vi.fn(),
  mockContactsCreate: vi.fn(),
  mockContactsUpdate: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({
    emails: { send: mockEmailsSend },
    batch: { send: mockBatchSend },
    broadcasts: { create: mockBroadcastsCreate },
    contacts: { create: mockContactsCreate, update: mockContactsUpdate },
  })),
}));

import { ResendEmailProvider } from "../resend-email.provider";

describe("ResendEmailProvider", () => {
  let provider: ResendEmailProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    // Zero out any real timers so exponential-backoff sleeps don't slow
    // the suite. We advance manually in retry tests where it matters.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    provider = new ResendEmailProvider();
  });

  // ─── send ─────────────────────────────────────────────────────────────────

  describe("send", () => {
    it("maps EmailParams to the SDK payload + forwards idempotencyKey", async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: "msg_1" }, error: null });

      const result = await provider.send({
        to: "a@test.com",
        from: "Teranga <no-reply@terangaevent.com>",
        subject: "Hi",
        html: "<p>hi</p>",
        text: "hi",
        replyTo: "support@terangaevent.com",
        tags: [{ name: "category", value: "transactional" }],
        headers: { "X-Custom": "1" },
        idempotencyKey: "reg-confirm/reg-1",
      });

      expect(result).toEqual({ success: true, messageId: "msg_1" });
      expect(mockEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Teranga <no-reply@terangaevent.com>",
          to: ["a@test.com"],
          subject: "Hi",
          html: "<p>hi</p>",
          text: "hi",
          replyTo: "support@terangaevent.com",
          tags: [{ name: "category", value: "transactional" }],
          headers: { "X-Custom": "1" },
        }),
        { idempotencyKey: "reg-confirm/reg-1" },
      );
    });

    it("surfaces SDK validation errors without retrying", async () => {
      mockEmailsSend.mockResolvedValue({
        data: null,
        error: { name: "validation_error", message: "invalid from" },
      });

      const result = await provider.send({ to: "a@test.com", subject: "s", html: "<p>h</p>" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("validation_error");
      expect(mockEmailsSend).toHaveBeenCalledTimes(1); // no retry
    });

    it("retries on rate_limit_exceeded and recovers", async () => {
      mockEmailsSend
        .mockResolvedValueOnce({
          data: null,
          error: { name: "rate_limit_exceeded", message: "slow down" },
        })
        .mockResolvedValueOnce({ data: { id: "msg_after_retry" }, error: null });

      const promise = provider.send({ to: "a@test.com", subject: "s", html: "<p>h</p>" });
      // Drain the 1s backoff scheduled by withRetry.
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result).toEqual({ success: true, messageId: "msg_after_retry" });
      expect(mockEmailsSend).toHaveBeenCalledTimes(2);
    });

    it("retries on api_error (5xx) too, not just 429", async () => {
      mockEmailsSend
        .mockResolvedValueOnce({
          data: null,
          error: { name: "api_error", message: "server error" },
        })
        .mockResolvedValueOnce({ data: { id: "msg_ok" }, error: null });

      const promise = provider.send({ to: "a@test.com", subject: "s", html: "<p>h</p>" });
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockEmailsSend).toHaveBeenCalledTimes(2);
    });

    it("gives up after the retry budget and returns the final error", async () => {
      mockEmailsSend.mockResolvedValue({
        data: null,
        error: { name: "rate_limit_exceeded", message: "still throttled" },
      });

      const promise = provider.send({ to: "a@test.com", subject: "s", html: "<p>h</p>" });
      // 3 retries — 1s + 2s + 4s
      await vi.advanceTimersByTimeAsync(7_000);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(mockEmailsSend).toHaveBeenCalledTimes(4); // initial + 3 retries
    });
  });

  // ─── sendBulk ─────────────────────────────────────────────────────────────

  describe("sendBulk", () => {
    it("delegates to batch.send and scopes idempotencyKey per chunk", async () => {
      mockBatchSend.mockResolvedValue({
        data: { data: [{ id: "m1" }, { id: "m2" }] },
        error: null,
      });

      const result = await provider.sendBulk(
        [
          { to: "a@test.com", subject: "s", html: "<p>h</p>" },
          { to: "b@test.com", subject: "s", html: "<p>h</p>" },
        ],
        { idempotencyKey: "batch-cancel/evt-1" },
      );

      expect(mockBatchSend).toHaveBeenCalledWith(expect.any(Array), {
        idempotencyKey: "batch-cancel/evt-1/chunk-0",
      });
      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
    });

    it("records per-email failures when the batch fails", async () => {
      mockBatchSend.mockResolvedValue({
        data: null,
        error: { name: "validation_error", message: "bad payload" },
      });

      const result = await provider.sendBulk([
        { to: "a@test.com", subject: "s", html: "<p>h</p>" },
      ]);

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0].error).toContain("validation_error");
    });

    it("strips attachments on the batch path (batch endpoint rejects them)", async () => {
      mockBatchSend.mockResolvedValue({ data: { data: [{ id: "m1" }] }, error: null });

      await provider.sendBulk([
        {
          to: "a@test.com",
          subject: "s",
          html: "<p>h</p>",
          attachments: [{ filename: "pdf", content: "base64", contentType: "application/pdf" }],
        },
      ]);

      const payload = mockBatchSend.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(payload[0]).not.toHaveProperty("attachments");
    });
  });

  // ─── Broadcasts ───────────────────────────────────────────────────────────

  describe("createAndSendBroadcast", () => {
    it("creates a broadcast with send:true and maps the segmentId field", async () => {
      mockBroadcastsCreate.mockResolvedValue({ data: { id: "bc_42" }, error: null });

      const result = await provider.createAndSendBroadcast({
        segmentId: "seg_abc",
        from: "Teranga <news@terangaevent.com>",
        subject: "April news",
        html: "<p>Hi {{{RESEND_UNSUBSCRIBE_URL}}}</p>",
        replyTo: "contact@terangaevent.com",
        name: "April 2026",
      });

      expect(mockBroadcastsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          segmentId: "seg_abc",
          from: "Teranga <news@terangaevent.com>",
          subject: "April news",
          send: true,
          replyTo: "contact@terangaevent.com",
          name: "April 2026",
        }),
      );
      expect(result).toEqual({ success: true, broadcastId: "bc_42" });
    });

    it("returns a typed error when Resend rejects the broadcast", async () => {
      mockBroadcastsCreate.mockResolvedValue({
        data: null,
        error: { name: "validation_error", message: "missing subject" },
      });

      const result = await provider.createAndSendBroadcast({
        segmentId: "seg_abc",
        from: "Teranga <news@terangaevent.com>",
        subject: "",
        html: "<p>x</p>",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("validation_error");
    });
  });

  // ─── Contacts ─────────────────────────────────────────────────────────────

  describe("createContact", () => {
    it("assigns the contact to the segment in one call", async () => {
      mockContactsCreate.mockResolvedValue({ data: { id: "cont_1" }, error: null });

      const result = await provider.createContact("seg_abc", { email: "user@test.com" });

      expect(mockContactsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "user@test.com",
          segments: [{ id: "seg_abc" }],
        }),
      );
      expect(result).toEqual({ success: true, contactId: "cont_1" });
    });

    it("treats duplicate contact as success (alreadyExists)", async () => {
      mockContactsCreate.mockResolvedValue({
        data: null,
        error: { name: "invalid_idempotent_request", message: "already exists" },
      });

      const result = await provider.createContact("seg_abc", { email: "dup@test.com" });

      expect(result).toEqual({ success: true, alreadyExists: true });
    });
  });

  describe("unsubscribeContact", () => {
    it("flips the unsubscribed flag without deleting", async () => {
      mockContactsUpdate.mockResolvedValue({ data: { id: "cont_1" }, error: null });

      const result = await provider.unsubscribeContact("user@test.com");

      expect(mockContactsUpdate).toHaveBeenCalledWith({
        email: "user@test.com",
        unsubscribed: true,
      });
      expect(result).toEqual({ success: true });
    });
  });
});
