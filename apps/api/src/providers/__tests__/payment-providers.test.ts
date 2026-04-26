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

  it("throws ProviderError (no body in message) on Wave API error — P1-11", async () => {
    // Regression guard for P1-11 (audit C5): the previous shape was
    // `throw new Error(\`Wave API error (\${status}): \${body}\`)` which
    // surfaced provider-internal traces (Wave's debug breadcrumbs,
    // sometimes customer phone numbers) to anyone who could trigger a
    // 4xx/5xx. The new contract:
    //   - throws `ProviderError` (typed, code: PROVIDER_ERROR, 502)
    //   - `details.providerName === "wave"`
    //   - `details.httpStatus === 400`
    //   - `Error.message` contains NO substring of the raw body
    //   - body is logged out-of-band via `logProviderError`
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "internal-debug-trace-XYZ",
    });

    const { WavePaymentProvider } = await import("../wave-payment.provider");
    const { ProviderError } = await import("@/errors/app-error");
    const provider = new WavePaymentProvider();

    let caught: unknown;
    try {
      await provider.initiate({
        paymentId: "pay-1",
        amount: 5000,
        currency: "XOF",
        description: "Test",
        callbackUrl: "http://x",
        returnUrl: "http://x",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProviderError);
    const e = caught as InstanceType<typeof ProviderError>;
    expect(e.providerName).toBe("wave");
    expect(e.httpStatus).toBe(400);
    expect(e.code).toBe("PROVIDER_ERROR");
    expect(e.statusCode).toBe(502);
    // Body MUST NOT appear in the user-facing message.
    expect(e.message).not.toContain("internal-debug-trace-XYZ");

    // Body MUST appear in the structured stderr log so SRE keeps the
    // diagnostic.
    const stderrCalls = stderrSpy.mock.calls.flat().join("");
    expect(stderrCalls).toContain("internal-debug-trace-XYZ");
    expect(stderrCalls).toContain('"providerName":"wave"');
    expect(stderrCalls).toContain('"operation":"initiate"');

    stderrSpy.mockRestore();
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

  it("throws ProviderError (no body in message) on OM API error — P1-11", async () => {
    // Regression guard for P1-11 (audit C5) — same contract as the
    // Wave equivalent above: structured ProviderError, body logged
    // out-of-band, never concatenated into the user-facing message.
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // OAuth token may be cached from prior test, so mock payment call as first or second
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("oauth")) {
        return { ok: true, json: async () => ({ access_token: "token_err", expires_in: 3600 }) };
      }
      return {
        ok: false,
        status: 500,
        text: async () => "om-internal-trace-ABC",
      };
    });

    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const { ProviderError } = await import("@/errors/app-error");
    const provider = new OrangeMoneyPaymentProvider();

    let caught: unknown;
    try {
      await provider.initiate({
        paymentId: "pay-2",
        amount: 10000,
        currency: "XOF",
        description: "Test",
        callbackUrl: "http://x",
        returnUrl: "http://x",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProviderError);
    const e = caught as InstanceType<typeof ProviderError>;
    expect(e.providerName).toBe("orange_money");
    expect(e.httpStatus).toBe(500);
    expect(e.message).not.toContain("om-internal-trace-ABC");

    const stderrCalls = stderrSpy.mock.calls.flat().join("");
    expect(stderrCalls).toContain("om-internal-trace-ABC");
    expect(stderrCalls).toContain('"providerName":"orange_money"');

    stderrSpy.mockRestore();
  });

  it("strips notif_token from OM initiate response — P1-10", async () => {
    // Regression guard for P1-10 (audit C4): the OM initiate response
    // carries `notif_token` (the pre-shared symmetric secret OM uses
    // to sign callbacks). The provider MUST explicitly delete it
    // BEFORE the parsed body can be observed by anything else, so it
    // can't end up in `providerMetadata`, audit logs, or the returned
    // `InitiateResult`.
    mockFetch.mockReset();
    // First call: OAuth token (cache may already be warm; mock both
    // shapes via mockImplementation so the test is order-independent).
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("oauth")) {
        return {
          ok: true,
          json: async () => ({ access_token: "token_strip", expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          pay_token: "om_strip_pay",
          payment_url: "https://om.orange.sn/pay/strip",
          // The dangerous field — verify it does not surface anywhere.
          notif_token: "SUPER-SECRET-NOTIF-TOKEN-DO-NOT-LEAK",
        }),
      };
    });

    const { OrangeMoneyPaymentProvider } = await import("../orange-money-payment.provider");
    const provider = new OrangeMoneyPaymentProvider();

    const result = await provider.initiate({
      paymentId: "pay-3",
      amount: 7500,
      currency: "XOF",
      description: "Strip notif_token test",
      callbackUrl: "http://x",
      returnUrl: "http://x",
    });

    expect(result.providerTransactionId).toBe("om_strip_pay");
    expect(result.redirectUrl).toBe("https://om.orange.sn/pay/strip");
    // Belt-and-suspenders: serialise the whole result and ensure no
    // substring of the secret survives.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("SUPER-SECRET-NOTIF-TOKEN-DO-NOT-LEAK");
    expect(serialised).not.toContain("notif_token");
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
