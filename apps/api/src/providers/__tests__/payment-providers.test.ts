import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock fetch globally ────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Wave Provider ──────────────────────────────────────────────────────────

describe("WavePaymentProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initiates a payment and returns redirect URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "wave_session_123",
        wave_launch_url: "https://pay.wave.com/c/wave_session_123",
        checkout_status: "open",
      }),
    });

    const { WavePaymentProvider } = await import("../wave-payment.provider");
    const provider = new WavePaymentProvider();

    const result = await provider.initiate({
      paymentId: "pay-1",
      amount: 5000,
      currency: "XOF",
      description: "Test payment",
      callbackUrl: "http://localhost:3000/webhook",
      returnUrl: "http://localhost:3002/success",
    });

    expect(result.providerTransactionId).toBe("wave_session_123");
    expect(result.redirectUrl).toBe("https://pay.wave.com/c/wave_session_123");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/checkout/sessions");
    expect(opts.method).toBe("POST");
  });

  it("throws on Wave API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Bad request",
    });

    const { WavePaymentProvider } = await import("../wave-payment.provider");
    const provider = new WavePaymentProvider();

    await expect(
      provider.initiate({
        paymentId: "pay-1",
        amount: 5000,
        currency: "XOF",
        description: "Test",
        callbackUrl: "http://x",
        returnUrl: "http://x",
      }),
    ).rejects.toThrow("Wave API error");
  });

  it("verifies payment status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        checkout_status: "complete",
        payment_status: "complete",
      }),
    });

    const { WavePaymentProvider } = await import("../wave-payment.provider");
    const provider = new WavePaymentProvider();

    const result = await provider.verify("wave_session_123");
    expect(result.status).toBe("succeeded");
  });

  it("returns failed for verify error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const { WavePaymentProvider } = await import("../wave-payment.provider");
    const provider = new WavePaymentProvider();

    const result = await provider.verify("nonexistent");
    expect(result.status).toBe("failed");
  });

  it("processes refund", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "refund_123" }),
    });

    const { WavePaymentProvider } = await import("../wave-payment.provider");
    const provider = new WavePaymentProvider();

    const result = await provider.refund("wave_session_123", 2500);
    expect(result.success).toBe(true);
    expect(result.providerRefundId).toBe("refund_123");
  });
});

// ─── Orange Money Provider ──────────────────────────────────────────────────

describe("OrangeMoneyPaymentProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initiates a payment via Orange Money", async () => {
    // First call: OAuth token
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "token_123", expires_in: 3600 }),
    });
    // Second call: payment initiation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        pay_token: "om_pay_123",
        payment_url: "https://om.orange.sn/pay/om_pay_123",
        notif_token: "notif_tok",
      }),
    });

    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const provider = new OrangeMoneyPaymentProvider();

    const result = await provider.initiate({
      paymentId: "pay-2",
      amount: 10000,
      currency: "XOF",
      description: "OM test",
      callbackUrl: "http://localhost:3000/webhook",
      returnUrl: "http://localhost:3002/success",
    });

    expect(result.providerTransactionId).toBe("om_pay_123");
    expect(result.redirectUrl).toContain("om.orange.sn");
  });

  it("throws on OM API error", async () => {
    // OAuth token may be cached from prior test, so mock payment call as first or second
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("oauth")) {
        return { ok: true, json: async () => ({ access_token: "token_err", expires_in: 3600 }) };
      }
      return { ok: false, status: 500, text: async () => "Server error" };
    });

    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const provider = new OrangeMoneyPaymentProvider();

    await expect(
      provider.initiate({
        paymentId: "pay-2",
        amount: 10000,
        currency: "XOF",
        description: "Test",
        callbackUrl: "http://x",
        returnUrl: "http://x",
      }),
    ).rejects.toThrow("Orange Money API error");
  });

  it("refund is not supported and returns false", async () => {
    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const provider = new OrangeMoneyPaymentProvider();

    const result = await provider.refund("om_pay_123", 5000);
    expect(result.success).toBe(false);
  });
});
