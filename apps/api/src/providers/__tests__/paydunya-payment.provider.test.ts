import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

// PayDunya provider — Phase 2 implementation tests.
// Spec: docs-v2/30-api/providers/paydunya.md
//
// Coverage map (per CLAUDE.md teranga-testing skill):
//   - Happy initiate     → InitiateResult shape, headers, base URL
//   - Initiate errors    → ProviderError typed throw, body NOT in message
//   - Initiate timeout   → ProviderError(network_timeout, retriable)
//   - verify() success   → status mapping, no throw
//   - verify() 4004      → failed without throw (reconciliation safe)
//   - verify() 5xx       → failed without throw, body logged
//   - refund()           → always {success: false, manual_refund_required}
//   - verifyWebhook OK   → SHA-512(MasterKey) accepted
//   - verifyWebhook KO   → mismatched / empty / wrong-length / no data /
//                          unset secret all return false (no throw)
//   - extractDataField   → URLSearchParams + edge cases

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  // Default test env — sandbox, all 3 keys set so initiate works.
  process.env.PAYDUNYA_MODE = "sandbox";
  process.env.PAYDUNYA_MASTER_KEY = "test-master-key";
  process.env.PAYDUNYA_PRIVATE_KEY = "test-private-key";
  process.env.PAYDUNYA_TOKEN = "test-token";
  process.env.PAYDUNYA_STORE_NAME = "Teranga Test";
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ─── initiate() ─────────────────────────────────────────────────────────────

describe("PayDunyaPaymentProvider.initiate", () => {
  it("creates a hosted-checkout invoice and returns the redirect URL — happy path", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "00",
        response_text: "https://paydunya.com/checkout/invoice/PAYDUNYA_TOKEN_ABC",
        description: "Invoice créée avec succès",
        token: "PAYDUNYA_TOKEN_ABC",
      }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const result = await provider.initiate({
      paymentId: "pay_test_1",
      amount: 5000,
      currency: "XOF",
      description: "Inscription : Conférence Dakar Tech",
      callbackUrl: "https://api.teranga.app/v1/payments/webhook/paydunya",
      returnUrl: "https://app.teranga.app/registrations/reg_1/success",
      method: "wave",
    });

    expect(result.providerTransactionId).toBe("PAYDUNYA_TOKEN_ABC");
    expect(result.redirectUrl).toBe("https://paydunya.com/checkout/invoice/PAYDUNYA_TOKEN_ABC");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify request shape: sandbox base URL, all 3 PayDunya headers,
    // payment_id surfaced into custom_data for the cross-check invariant.
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create");
    expect(opts.method).toBe("POST");
    expect(opts.headers["PAYDUNYA-MASTER-KEY"]).toBe("test-master-key");
    expect(opts.headers["PAYDUNYA-PRIVATE-KEY"]).toBe("test-private-key");
    expect(opts.headers["PAYDUNYA-TOKEN"]).toBe("test-token");
    expect(opts.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body);
    expect(body.invoice.total_amount).toBe(5000);
    expect(body.invoice.description).toContain("Conférence Dakar");
    expect(body.actions.callback_url).toContain("/v1/payments/webhook/paydunya");
    expect(body.actions.return_url).toContain("/registrations/reg_1/success");
    expect(body.custom_data.payment_id).toBe("pay_test_1");
    expect(body.custom_data.method).toBe("wave");
    expect(body.store.name).toBe("Teranga Test");
  });

  it("uses the live base URL when PAYDUNYA_MODE=live", async () => {
    process.env.PAYDUNYA_MODE = "live";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "00",
        response_text: "https://paydunya.com/checkout/invoice/LIVE_TOKEN",
        token: "LIVE_TOKEN",
      }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    await provider.initiate({
      paymentId: "pay_live_1",
      amount: 1000,
      currency: "XOF",
      description: "test",
      callbackUrl: "https://x",
      returnUrl: "https://x",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://app.paydunya.com/api/v1/checkout-invoice/create");
  });

  it("falls back to canonical hosted-URL if response_text is not a URL", async () => {
    // Defensive: PayDunya's API has historically returned the URL in
    // response_text BUT a future API version could move it. The
    // provider falls back to building the URL from the token so the
    // initiate path remains functional.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "00",
        response_text: "Invoice créée avec succès", // not a URL
        token: "FALLBACK_TOKEN",
      }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const result = await provider.initiate({
      paymentId: "pay_fallback",
      amount: 2000,
      currency: "XOF",
      description: "test",
      callbackUrl: "https://x",
      returnUrl: "https://x",
    });

    expect(result.redirectUrl).toBe("https://paydunya.com/checkout/invoice/FALLBACK_TOKEN");
  });

  it("throws ProviderError on response_code !== '00' (no body in user-facing message)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "08",
        response_text: "Le champ total_amount est obligatoire",
      }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const { ProviderError } = await import("@/errors/app-error");
    const provider = new PayDunyaPaymentProvider();

    let caught: unknown;
    try {
      await provider.initiate({
        paymentId: "pay_err",
        amount: 5000,
        currency: "XOF",
        description: "test",
        callbackUrl: "https://x",
        returnUrl: "https://x",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProviderError);
    const e = caught as InstanceType<typeof ProviderError>;
    expect(e.providerName).toBe("paydunya");
    expect(e.providerCode).toBe("08");
    expect(e.code).toBe("PROVIDER_ERROR");
    expect(e.statusCode).toBe(502);
    // Body MUST NOT appear in the user-facing message (P1-11 contract).
    expect(e.message).not.toContain("total_amount");
    expect(e.retriable).toBe(false);

    // Body landed in stderr for SRE.
    const stderrOutput = stderrSpy.mock.calls.flat().join("");
    expect(stderrOutput).toContain('"providerName":"paydunya"');
    expect(stderrOutput).toContain('"operation":"initiate"');

    stderrSpy.mockRestore();
  });

  it("flags retriable codes (50, 99) on the ProviderError so the service can retry", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "50",
        response_text: "Erreur réseau wallet upstream",
      }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const { ProviderError } = await import("@/errors/app-error");
    const provider = new PayDunyaPaymentProvider();

    await expect(
      provider.initiate({
        paymentId: "pay_retry",
        amount: 5000,
        currency: "XOF",
        description: "test",
        callbackUrl: "https://x",
        returnUrl: "https://x",
      }),
    ).rejects.toMatchObject({
      providerCode: "50",
      retriable: true,
    } as Partial<InstanceType<typeof ProviderError>>);

    stderrSpy.mockRestore();
  });

  // Test-coverage audit follow-up — `!json.token` guard covers a
  // PayDunya API drift where the response_code is "00" but the
  // token is missing. Silent mishandling without this guard.
  it("throws ProviderError when response_code='00' but token is missing (API drift guard)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "00",
        response_text: "https://paydunya.com/some-url",
        // token field deliberately absent
      }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const { ProviderError } = await import("@/errors/app-error");
    const provider = new PayDunyaPaymentProvider();

    let caught: unknown;
    try {
      await provider.initiate({
        paymentId: "pay_no_token",
        amount: 5000,
        currency: "XOF",
        description: "test",
        callbackUrl: "https://x",
        returnUrl: "https://x",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    const e = caught as InstanceType<typeof ProviderError>;
    expect(e.providerName).toBe("paydunya");
    // Body wasn't an "08" — the guard fires before any mapping kicks
    // in, so providerCode is the response_code string itself ("00")
    // OR undefined depending on where the guard lands. Either way,
    // the error MUST be raised (no silent acceptance).
    stderrSpy.mockRestore();
  });

  it("throws ProviderError(network_timeout, retriable) on AbortError", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockFetch.mockImplementationOnce(async () => {
      const e = new Error("The operation was aborted");
      e.name = "AbortError";
      throw e;
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const { ProviderError } = await import("@/errors/app-error");
    const provider = new PayDunyaPaymentProvider();

    let caught: unknown;
    try {
      await provider.initiate({
        paymentId: "pay_timeout",
        amount: 5000,
        currency: "XOF",
        description: "test",
        callbackUrl: "https://x",
        returnUrl: "https://x",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    const e = caught as InstanceType<typeof ProviderError>;
    expect(e.providerCode).toBe("network_timeout");
    expect(e.retriable).toBe(true);

    stderrSpy.mockRestore();
  });
});

// ─── verify() ───────────────────────────────────────────────────────────────

describe("PayDunyaPaymentProvider.verify", () => {
  it("maps PayDunya `completed` to succeeded", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "00",
        response_text: "Facture trouvée",
        invoice: { token: "TKN", total_amount: 5000, description: "desc" },
        custom_data: { payment_id: "pay_1" },
        status: "completed",
        receipt_url: "https://paydunya.com/receipt/TKN.pdf",
      }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const result = await provider.verify("TKN");
    expect(result.status).toBe("succeeded");
    expect((result.metadata as { rawStatus?: string }).rawStatus).toBe("completed");
    expect((result.metadata as { receiptUrl?: string }).receiptUrl).toBe(
      "https://paydunya.com/receipt/TKN.pdf",
    );
  });

  it("maps PayDunya `cancelled` / `failed` / `expired` to failed", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    for (const status of ["cancelled", "failed", "expired"]) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ response_code: "00", response_text: "ok", status }),
      });
      const result = await provider.verify("TKN");
      expect(result.status).toBe("failed");
      expect((result.metadata as { rawStatus?: string }).rawStatus).toBe(status);
    }
  });

  it("maps PayDunya `pending` (and unknown statuses) to pending", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    for (const status of ["pending", "unknown_state", undefined]) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ response_code: "00", status }),
      });
      const result = await provider.verify("TKN");
      expect(result.status).toBe("pending");
    }
  });

  it("returns failed (NOT throws) on response_code 4004 — invoice not found", async () => {
    // Reconciliation safety: verify() is called by the periodic
    // sweeper job over many payments. A throw would abort the whole
    // batch — instead we surface as `failed` with metadata so the
    // sweep continues and the operator dashboard shows the cause.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "4004",
        response_text: "Invoice not found",
      }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const result = await provider.verify("MISSING_TKN");
    expect(result.status).toBe("failed");
    expect((result.metadata as { reason?: string }).reason).toBe("transaction_not_found");
    expect((result.metadata as { responseCode?: string }).responseCode).toBe("4004");
  });

  it("returns failed (NOT throws) on network errors", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockFetch.mockImplementationOnce(async () => {
      throw new TypeError("fetch failed: ENOTFOUND");
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const result = await provider.verify("NET_ERR");
    expect(result.status).toBe("failed");
    expect((result.metadata as { reason?: string }).reason).toBe("network_error");

    stderrSpy.mockRestore();
  });

  it("returns failed on malformed JSON response (graceful degradation)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not JSON");
      },
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const result = await provider.verify("BAD_JSON");
    expect(result.status).toBe("failed");
    expect((result.metadata as { reason?: string }).reason).toBe("malformed_response");
  });

  // Test-coverage audit follow-up — generic provider-error branch
  // when response_code is non-"00" and not in NOT_FOUND_CODES.
  // Covers wallet-upstream errors / "08" malformed-field / etc. that
  // the reconciliation sweep needs to surface as `failed` without
  // crashing the batch.
  it("returns failed (NOT throws) on a non-recognised response_code (e.g. '08')", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "08",
        response_text: "Le champ total_amount est obligatoire",
      }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const result = await provider.verify("PROVIDER_ERR");
    expect(result.status).toBe("failed");
    expect((result.metadata as { reason?: string }).reason).toBe("provider_error");
    expect((result.metadata as { responseCode?: string }).responseCode).toBe("08");

    // Confirms the body is logged out-of-band (P1-11 contract).
    const stderrOutput = stderrSpy.mock.calls.flat().join("");
    expect(stderrOutput).toContain('"providerName":"paydunya"');
    expect(stderrOutput).toContain('"operation":"verify"');

    stderrSpy.mockRestore();
  });

  // Test-coverage audit follow-up — `42` is the second member of
  // NOT_FOUND_CODES (alongside `4004`). A regression that drops it
  // from the set would silently route expired invoices to the
  // generic provider-error path. Pin both members.
  it("returns failed with reason='transaction_not_found' on response_code 42 (expired)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "42",
        response_text: "Token invalid or expired",
      }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const result = await provider.verify("EXPIRED_TKN");
    expect(result.status).toBe("failed");
    expect((result.metadata as { reason?: string }).reason).toBe("transaction_not_found");
    expect((result.metadata as { responseCode?: string }).responseCode).toBe("42");
  });

  it("URL-encodes the providerTransactionId in the path", async () => {
    // Defensive: even though we control the token format, a future
    // provider migration could introduce non-URL-safe chars.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response_code: "00", status: "completed" }),
    });

    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    await provider.verify("token/with/slashes");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("token%2Fwith%2Fslashes");
  });
});

// ─── refund() ───────────────────────────────────────────────────────────────

describe("PayDunyaPaymentProvider.refund", () => {
  it("always returns {success: false, reason: manual_refund_required} — PayDunya has no public refund API", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const result = await provider.refund("ANY_TOKEN", 5000);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("manual_refund_required");
    // CRITICAL: no fetch was called — refund is a pure no-op at the
    // provider layer. The service.refundPayment surfaces a French
    // operator-facing message ("Contactez votre point de vente …")
    // and the operator processes the refund via the merchant portal.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── verifyWebhook() ────────────────────────────────────────────────────────
//
// PayDunya's IPN signature scheme: the request body is
// `application/x-www-form-urlencoded` with a single field `data` whose
// value is JSON-stringified. The JSON contains a `hash` field — the
// SHA-512 of the merchant's MasterKey, hex-encoded.
//
// Critical invariants per spec §6.2:
//   - constant-time compare via `timingSafeEqual` (length-checked)
//   - fail-CLOSED on missing secret
//   - fail-CLOSED on malformed body / data field / hash field
//   - empty signature, wrong-length, mismatched all return false
//     WITHOUT throwing (P1-25 invariant ported to PayDunya)

describe("PayDunyaPaymentProvider.verifyWebhook", () => {
  function buildSignedBody(masterKey: string, payload: Record<string, unknown> = {}): string {
    const hash = createHash("sha512").update(masterKey).digest("hex");
    const data = JSON.stringify({ hash, ...payload });
    return `data=${encodeURIComponent(data)}`;
  }

  it("accepts a valid signature (SHA-512 of MasterKey, hex)", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const rawBody = buildSignedBody("test-master-key", {
      response_code: "00",
      status: "completed",
      invoice: { token: "TKN", total_amount: 5000 },
      custom_data: { payment_id: "pay_1" },
    });

    expect(provider.verifyWebhook({ rawBody, headers: {} })).toBe(true);
  });

  it("rejects when the hash is computed with a wrong MasterKey (forgery)", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const rawBody = buildSignedBody("DIFFERENT-MASTER-KEY");
    expect(provider.verifyWebhook({ rawBody, headers: {} })).toBe(false);
  });

  it("rejects when MasterKey is unset (fail-CLOSED defence-in-depth on top of P1-18 boot assertion)", async () => {
    delete process.env.PAYDUNYA_MASTER_KEY;
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();

    const rawBody = `data=${encodeURIComponent(JSON.stringify({ hash: "any-hash" }))}`;
    expect(provider.verifyWebhook({ rawBody, headers: {} })).toBe(false);
  });

  it("rejects when MasterKey is whitespace-only", async () => {
    process.env.PAYDUNYA_MASTER_KEY = "   ";
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();
    const rawBody = `data=${encodeURIComponent(JSON.stringify({ hash: "x" }))}`;
    expect(provider.verifyWebhook({ rawBody, headers: {} })).toBe(false);
  });

  it("rejects an empty body", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();
    expect(provider.verifyWebhook({ rawBody: "", headers: {} })).toBe(false);
  });

  it("rejects a body without a `data` field", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();
    expect(provider.verifyWebhook({ rawBody: "other=value", headers: {} })).toBe(false);
  });

  it("rejects a `data` field that isn't JSON", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();
    expect(
      provider.verifyWebhook({ rawBody: "data=not-json", headers: {} }),
    ).toBe(false);
  });

  it("rejects a payload missing the `hash` field", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();
    const rawBody = `data=${encodeURIComponent(JSON.stringify({ no_hash: true }))}`;
    expect(provider.verifyWebhook({ rawBody, headers: {} })).toBe(false);
  });

  it("rejects a `hash` of wrong length (truncated) WITHOUT throwing — P1-25 invariant", async () => {
    // Critical regression guard: timingSafeEqual THROWS on unequal-
    // length buffers. The provider MUST length-check first and
    // return false cleanly.
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();
    const fullHash = createHash("sha512").update("test-master-key").digest("hex");
    const truncated = fullHash.slice(0, fullHash.length - 8);
    const rawBody = `data=${encodeURIComponent(JSON.stringify({ hash: truncated }))}`;
    expect(provider.verifyWebhook({ rawBody, headers: {} })).toBe(false);
  });

  it("rejects a `hash` containing non-hex characters", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();
    const rawBody = `data=${encodeURIComponent(JSON.stringify({ hash: "ZZZZNOTHEX" }))}`;
    expect(provider.verifyWebhook({ rawBody, headers: {} })).toBe(false);
  });

  it("rejects when `hash` is the empty string", async () => {
    const { PayDunyaPaymentProvider } = await import("../paydunya-payment.provider");
    const provider = new PayDunyaPaymentProvider();
    const rawBody = `data=${encodeURIComponent(JSON.stringify({ hash: "" }))}`;
    expect(provider.verifyWebhook({ rawBody, headers: {} })).toBe(false);
  });
});

// ─── extractDataField (helper) ─────────────────────────────────────────────

describe("extractDataField", () => {
  it("extracts the data field from a form-encoded body", async () => {
    const { extractDataField } = await import("../paydunya-payment.provider");
    expect(extractDataField("data=hello")).toBe("hello");
  });

  it("URL-decodes the value", async () => {
    const { extractDataField } = await import("../paydunya-payment.provider");
    expect(extractDataField("data=%7B%22hash%22%3A%22abc%22%7D")).toBe('{"hash":"abc"}');
  });

  it("returns null when data field is missing", async () => {
    const { extractDataField } = await import("../paydunya-payment.provider");
    expect(extractDataField("foo=bar")).toBe(null);
  });

  it("returns null when data field is empty", async () => {
    const { extractDataField } = await import("../paydunya-payment.provider");
    expect(extractDataField("data=")).toBe(null);
  });

  it("returns null on empty / non-string input", async () => {
    const { extractDataField } = await import("../paydunya-payment.provider");
    expect(extractDataField("")).toBe(null);
    // @ts-expect-error - testing defensive guards
    expect(extractDataField(undefined)).toBe(null);
    // @ts-expect-error - testing defensive guards
    expect(extractDataField(null)).toBe(null);
  });

  it("ignores extra fields in a form-encoded body (only `data` matters)", async () => {
    const { extractDataField } = await import("../paydunya-payment.provider");
    expect(extractDataField("foo=bar&data=value&baz=qux")).toBe("value");
  });
});
