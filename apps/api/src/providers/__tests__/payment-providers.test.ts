import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

  it("refund is not supported and returns {success:false, reason:'manual_refund_required'}", async () => {
    // Regression guard: previously returned a bare `{success: false}` which
    // caused the payment service to throw the generic "provider refused"
    // message, unhelpful for an operator who needs to know they have to
    // refund manually via the OM merchant portal.
    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const provider = new OrangeMoneyPaymentProvider();

    const result = await provider.refund("om_pay_123", 5000);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("manual_refund_required");
  });
});

// ─── Webhook verification (per provider) ────────────────────────────────────

describe("verifyWebhook — per-provider signature verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Wave verifies HMAC-SHA256 over raw body keyed by WAVE_API_SECRET", async () => {
    // Regression guard: the webhook route used to re-serialise
    // `request.body` via JSON.stringify, changing key order and
    // breaking HMAC verification even when the secret was correct.
    // Provider now accepts raw-body + header bag and signs the
    // exact bytes the provider signed.
    process.env.WAVE_API_SECRET = "test-wave-secret";
    // Re-import with env set
    vi.resetModules();
    const { WavePaymentProvider } = await import("../wave-payment.provider");
    const provider = new WavePaymentProvider();

    const rawBody = '{"foo":"bar","amount":5000}';
    const crypto = await import("node:crypto");
    const signature = crypto.createHmac("sha256", "test-wave-secret").update(rawBody).digest("hex");

    expect(provider.verifyWebhook({ rawBody, headers: { "x-wave-signature": signature } })).toBe(
      true,
    );
    expect(
      provider.verifyWebhook({ rawBody, headers: { "x-wave-signature": "invalid-sig" } }),
    ).toBe(false);
    // Missing header → no signature → reject.
    expect(provider.verifyWebhook({ rawBody, headers: {} })).toBe(false);
  });

  it("Orange Money compares `x-om-token` header constant-time to ORANGE_MONEY_NOTIF_TOKEN", async () => {
    process.env.ORANGE_MONEY_NOTIF_TOKEN = "test-om-token-12345";
    vi.resetModules();
    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const provider = new OrangeMoneyPaymentProvider();

    expect(
      provider.verifyWebhook({
        rawBody: '{"status":"SUCCESS"}',
        headers: { "x-om-token": "test-om-token-12345" },
      }),
    ).toBe(true);
    expect(
      provider.verifyWebhook({
        rawBody: '{"status":"SUCCESS"}',
        headers: { "x-om-token": "wrong-token" },
      }),
    ).toBe(false);
    // Also accepts the `notif_token` header name (OM has used both).
    expect(
      provider.verifyWebhook({
        rawBody: "{}",
        headers: { notif_token: "test-om-token-12345" },
      }),
    ).toBe(true);
  });

  it("Orange Money rejects if ORANGE_MONEY_NOTIF_TOKEN is unset", async () => {
    delete process.env.ORANGE_MONEY_NOTIF_TOKEN;
    vi.resetModules();
    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const provider = new OrangeMoneyPaymentProvider();

    expect(
      provider.verifyWebhook({
        rawBody: "{}",
        headers: { "x-om-token": "anything" },
      }),
    ).toBe(false);
  });

  it("Mock verifies HMAC via PAYMENT_WEBHOOK_SECRET so dev checkout page keeps working", async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = "test-mock-secret";
    vi.resetModules();
    const { MockPaymentProvider } = await import("../mock-payment.provider");
    const provider = new MockPaymentProvider();

    const rawBody = '{"providerTransactionId":"mock_abc","status":"succeeded"}';
    const crypto = await import("node:crypto");
    const signature = crypto.createHmac("sha256", "test-mock-secret").update(rawBody).digest("hex");

    expect(provider.verifyWebhook({ rawBody, headers: { "x-webhook-signature": signature } })).toBe(
      true,
    );
    expect(provider.verifyWebhook({ rawBody, headers: { "x-webhook-signature": "bad" } })).toBe(
      false,
    );
  });
});

// ─── SPEC: Orange Money OAuth token cache expiry (post-audit) ────────────
// The OM provider caches the OAuth access token in a module-level
// closure (`cachedToken: { value, expiresAt }`) and refetches when
// `Date.now() >= expiresAt`. A 60 s grace window is baked in:
// `expiresAt = now + (expires_in - 60) * 1000`. Before this pass the
// suite never exercised the boundary — a regression that dropped the
// grace, flipped the comparison (`>` instead of `<`), or stopped
// honouring `expires_in` would have slipped past unit tests and only
// surfaced in production as silent 401s from OM after a token expired.
//
// Structural test using `vi.useFakeTimers`. Each case dynamically
// imports the provider to get a fresh module-scope cache.
describe("OrangeMoneyPaymentProvider — OAuth token cache expiry boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the cached token on subsequent calls while `now < expiresAt`", async () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    // Token lifetime: 3600 s → expiresAt = t0 + (3600 - 60) * 1000
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("oauth")) {
        return { ok: true, json: async () => ({ access_token: "tok_A", expires_in: 3600 }) };
      }
      return {
        ok: true,
        json: async () => ({
          pay_token: "om_1",
          payment_url: "https://om.test/1",
          notif_token: "nt",
        }),
      };
    });

    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const provider = new OrangeMoneyPaymentProvider();

    // 1st initiate: 2 fetches (OAuth + payment)
    await provider.initiate({
      paymentId: "p1",
      amount: 1000,
      currency: "XOF",
      description: "",
      callbackUrl: "",
      returnUrl: "",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Advance to 1 s BEFORE the cached expiresAt (= t0 + 3540 s - 1 s).
    // Must still be a cache hit. Expected fetches: 2 + 1 (payment) = 3.
    vi.setSystemTime(t0 + (3540 - 1) * 1000);
    await provider.initiate({
      paymentId: "p2",
      amount: 1000,
      currency: "XOF",
      description: "",
      callbackUrl: "",
      returnUrl: "",
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("refetches the token when `now >= expiresAt` (grace-window enforced)", async () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-01-01T12:00:00Z").getTime();
    vi.setSystemTime(t0);

    const oauthReturns: Array<{ access_token: string; expires_in: number }> = [
      { access_token: "tok_A", expires_in: 3600 },
      { access_token: "tok_B", expires_in: 3600 },
    ];
    let oauthCalls = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("oauth")) {
        const payload = oauthReturns[oauthCalls++];
        return { ok: true, json: async () => payload };
      }
      return {
        ok: true,
        json: async () => ({
          pay_token: "om_x",
          payment_url: "https://om.test/x",
          notif_token: "nt",
        }),
      };
    });

    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const provider = new OrangeMoneyPaymentProvider();

    await provider.initiate({
      paymentId: "p1",
      amount: 1000,
      currency: "XOF",
      description: "",
      callbackUrl: "",
      returnUrl: "",
    });
    expect(oauthCalls).toBe(1); // first fetch

    // Advance PAST expiresAt (t0 + 3540 s + 1 ms). Cache must now be
    // stale, triggering a refetch. Total oauth calls: 2.
    vi.setSystemTime(t0 + 3540 * 1000 + 1);
    await provider.initiate({
      paymentId: "p2",
      amount: 1000,
      currency: "XOF",
      description: "",
      callbackUrl: "",
      returnUrl: "",
    });
    expect(oauthCalls).toBe(2);
  });

  it("uses `expires_in - 60 s` grace window (sanity)", async () => {
    // Pre-expiry grace is the reason for the `-60` in the provider.
    // If someone regresses this to `-0` (token cached for its full
    // lifetime), OM might 401 us the moment we serve a nearly-expired
    // token. Verify by using a SHORT expires_in: 60 s lifetime → the
    // cache becomes stale immediately (Date.now() + (60 - 60)*1000 =
    // Date.now()), so a SECOND initiate in the same tick already
    // triggers a refetch.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z").getTime());

    let oauthCalls = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("oauth")) {
        oauthCalls++;
        return { ok: true, json: async () => ({ access_token: "tok_X", expires_in: 60 }) };
      }
      return {
        ok: true,
        json: async () => ({
          pay_token: "om_y",
          payment_url: "https://om.test/y",
          notif_token: "nt",
        }),
      };
    });

    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const provider = new OrangeMoneyPaymentProvider();

    await provider.initiate({
      paymentId: "p1",
      amount: 1000,
      currency: "XOF",
      description: "",
      callbackUrl: "",
      returnUrl: "",
    });
    // Advance 1 ms so Date.now() is strictly past the computed expiresAt.
    vi.setSystemTime(Date.now() + 1);
    await provider.initiate({
      paymentId: "p2",
      amount: 1000,
      currency: "XOF",
      description: "",
      callbackUrl: "",
      returnUrl: "",
    });
    // Two oauth fetches: the grace window is zero-effective on a 60 s
    // token, so the second initiate must refetch. If someone removes
    // the grace and uses `data.expires_in * 1000` directly, the second
    // initiate would reuse the still-live token and oauthCalls would
    // be 1 — this assertion catches that regression.
    expect(oauthCalls).toBe(2);
  });
});
