import crypto from "node:crypto";
import {
  type PaymentProvider,
  type InitiateParams,
  type InitiateResult,
  type VerifyResult,
  type RefundResult,
  type VerifyWebhookParams,
} from "./payment-provider.interface";
import { ProviderError } from "@/errors/app-error";
import { logProviderError } from "./provider-error-logger";

/**
 * Wave Mobile Money payment provider.
 *
 * Wave is the #1 mobile money provider in Senegal.
 * API docs: https://docs.wave.com/business/api
 *
 * Environment variables:
 * - WAVE_API_KEY: API key for Wave Business
 * - WAVE_API_SECRET: Secret for webhook signature verification
 * - WAVE_API_URL: Base URL (default: sandbox)
 */

const WAVE_API_URL = process.env.WAVE_API_URL ?? "https://api.wave.com/v1";
const WAVE_API_KEY = process.env.WAVE_API_KEY ?? "";
const WAVE_API_SECRET = process.env.WAVE_API_SECRET ?? "";

export class WavePaymentProvider implements PaymentProvider {
  readonly name = "wave";

  async initiate(params: InitiateParams): Promise<InitiateResult> {
    const response = await fetch(`${WAVE_API_URL}/checkout/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WAVE_API_KEY}`,
      },
      body: JSON.stringify({
        amount: String(params.amount),
        currency: params.currency,
        error_url: params.returnUrl,
        success_url: params.returnUrl,
        client_reference: params.paymentId,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      // P1-11 — body logged out-of-band via `logProviderError` so it
      // never reaches the user-facing `Error.message`. The previous
      // shape concatenated the body into the message and bubbled it
      // through the global Fastify error handler, exposing Wave's
      // internal traces to anyone who could trigger a 4xx/5xx.
      const body = await response.text().catch(() => "");
      logProviderError({
        providerName: "wave",
        operation: "initiate",
        httpStatus: response.status,
        body,
        paymentId: params.paymentId,
      });
      throw new ProviderError({
        providerName: "wave",
        httpStatus: response.status,
      });
    }

    const data = (await response.json()) as {
      id: string;
      wave_launch_url: string;
      checkout_status: string;
    };

    return {
      providerTransactionId: data.id,
      redirectUrl: data.wave_launch_url,
    };
  }

  async verify(providerTransactionId: string): Promise<VerifyResult> {
    const response = await fetch(`${WAVE_API_URL}/checkout/sessions/${providerTransactionId}`, {
      headers: { Authorization: `Bearer ${WAVE_API_KEY}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return { status: "failed", metadata: { reason: `Wave verify failed: ${response.status}` } };
    }

    const data = (await response.json()) as {
      checkout_status: string;
      payment_status?: string;
    };

    const statusMap: Record<string, "succeeded" | "failed" | "pending"> = {
      complete: "succeeded",
      failed: "failed",
      expired: "failed",
    };

    return {
      status: statusMap[data.payment_status ?? data.checkout_status] ?? "pending",
      metadata: data as unknown as Record<string, unknown>,
    };
  }

  async refund(providerTransactionId: string, amount: number): Promise<RefundResult> {
    // P1-19 (audit M7) — map Wave HTTP status + body codes to the
    // typed `RefundFailureReason` union. Operators see a
    // disambiguated message (network timeout → retry, insufficient
    // funds → top up wallet, already refunded → reconcile) instead
    // of the generic "Le remboursement a été refusé par le fournisseur"
    // placeholder. Body is logged out-of-band via `logProviderError`
    // so it never reaches the user-facing surface (P1-11 contract).
    let response: Response;
    try {
      response = await fetch(`${WAVE_API_URL}/refunds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WAVE_API_KEY}`,
        },
        body: JSON.stringify({
          checkout_session_id: providerTransactionId,
          amount: String(amount),
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err: unknown) {
      // Network-layer failure (DNS, TLS, abort on timeout). The fetch
      // spec emits `name === "AbortError"` (or `TimeoutError` on Node
      // ≥ 22) for `AbortSignal.timeout`. Either way the right
      // disambiguation is `network_timeout` — retriable from the
      // operator dashboard.
      const isTimeout =
        err && typeof err === "object" && "name" in err &&
        (err.name === "AbortError" || err.name === "TimeoutError");
      logProviderError({
        providerName: "wave",
        operation: "refund",
        httpStatus: 0,
        body: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      return {
        success: false,
        reason: isTimeout ? "network_timeout" : "provider_error",
      };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logProviderError({
        providerName: "wave",
        operation: "refund",
        httpStatus: response.status,
        body,
      });
      return {
        success: false,
        reason: mapWaveRefundReason(response.status, body),
        providerCode: extractWaveErrorCode(body),
      };
    }

    const data = (await response.json()) as { id: string };
    return { success: true, providerRefundId: data.id };
  }

  /**
   * Verify Wave webhook signature.
   * Wave signs webhooks with HMAC-SHA256 using the API secret.
   * Header: `X-Wave-Signature` carries a hex-encoded digest of the raw
   * request body. HMAC MUST be computed against the raw payload — any
   * re-serialisation via `JSON.stringify` changes key order and breaks
   * the comparison even when the secret is correct.
   */
  verifyWebhook(params: VerifyWebhookParams): boolean {
    if (!WAVE_API_SECRET) return false;
    const signature = readHeader(params.headers, "x-wave-signature");
    if (!signature) return false;
    return verifyHmacHex(WAVE_API_SECRET, params.rawBody, signature);
  }

  /**
   * Preserved for existing tests that import the static method directly.
   * Delegates to the shared HMAC helper.
   */
  static verifySignature(body: string, signature: string): boolean {
    if (!WAVE_API_SECRET) return false;
    return verifyHmacHex(WAVE_API_SECRET, body, signature);
  }
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const v = headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function verifyHmacHex(secret: string, body: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ─── Wave refund error mapping (P1-19) ──────────────────────────────────────
//
// Wave's refund API uses both HTTP status AND a body-level `code` slug.
// Sample error payloads observed in sandbox + reported by community
// integrators (no public catalog exists, so the mapping is pinned to
// what we've seen — the default falls through to `provider_error`):
//
//   {"code":"refund-already-issued","message":"…"}      → already_refunded
//   {"code":"insufficient-balance","message":"…"}        → insufficient_funds
//   {"code":"checkout-session-not-found","message":"…"}  → transaction_not_found
//   {"code":"checkout-not-eligible-for-refund","…"}      → already_refunded (covers expired window)
//
// HTTP status disambiguation (no body code): 404 → not-found, others
// fall through to `provider_error`.

import type { RefundFailureReason } from "./payment-provider.interface";

const WAVE_CODE_TO_REASON: Record<string, RefundFailureReason> = {
  "refund-already-issued": "already_refunded",
  "checkout-not-eligible-for-refund": "already_refunded",
  "insufficient-balance": "insufficient_funds",
  "insufficient-funds": "insufficient_funds",
  "checkout-session-not-found": "transaction_not_found",
  "refund-not-found": "transaction_not_found",
};

function mapWaveRefundReason(status: number, body: string): RefundFailureReason {
  const code = extractWaveErrorCode(body);
  if (code && WAVE_CODE_TO_REASON[code]) {
    return WAVE_CODE_TO_REASON[code];
  }
  if (status === 404) return "transaction_not_found";
  if (status === 408) return "network_timeout";
  return "provider_error";
}

function extractWaveErrorCode(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    if (typeof parsed.code === "string" && parsed.code.length > 0 && parsed.code.length <= 128) {
      return parsed.code;
    }
  } catch {
    // Not JSON — Wave occasionally returns plain-text error pages on
    // 5xx. Surface no providerCode in that case.
  }
  return undefined;
}

export const wavePaymentProvider = new WavePaymentProvider();
