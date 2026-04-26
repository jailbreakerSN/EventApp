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
 * Orange Money payment provider.
 *
 * Orange Money is the #2 mobile money provider in Senegal.
 * Uses the Orange Money Partner API.
 *
 * Environment variables:
 * - ORANGE_MONEY_API_URL: Base URL (default: sandbox)
 * - ORANGE_MONEY_CLIENT_ID: OAuth2 client ID
 * - ORANGE_MONEY_CLIENT_SECRET: OAuth2 client secret
 * - ORANGE_MONEY_MERCHANT_KEY: Merchant key for payment initiation
 */

const OM_API_URL =
  process.env.ORANGE_MONEY_API_URL ?? "https://api.orange.com/orange-money-webpay/dev/v1";
const OM_CLIENT_ID = process.env.ORANGE_MONEY_CLIENT_ID ?? "";
const OM_CLIENT_SECRET = process.env.ORANGE_MONEY_CLIENT_SECRET ?? "";
const OM_MERCHANT_KEY = process.env.ORANGE_MONEY_MERCHANT_KEY ?? "";
// Pre-shared token OM merchants configure in their developer dashboard;
// OM sends it back on every webhook as `notif_token` header so we can
// verify the call is authentic. Separate env var from the OAuth secret
// because it's not a client credential — it's a shared symmetric token.
const OM_NOTIF_TOKEN = process.env.ORANGE_MONEY_NOTIF_TOKEN ?? "";

// Cache OAuth token in memory
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const credentials = Buffer.from(`${OM_CLIENT_ID}:${OM_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://api.orange.com/oauth/v3/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    // P1-11 — raw OAuth body kept off the user-facing error. Logged
    // via `logProviderError` (request-context aware) so SRE keeps
    // the diagnostic without leaking provider internals to clients.
    const body = await response.text().catch(() => "");
    logProviderError({
      providerName: "orange_money",
      operation: "oauth_token",
      httpStatus: response.status,
      body,
    });
    throw new ProviderError({
      providerName: "orange_money",
      httpStatus: response.status,
      providerCode: "oauth_failed",
    });
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 60s early
  };

  return cachedToken.value;
}

export class OrangeMoneyPaymentProvider implements PaymentProvider {
  readonly name = "orange_money";

  async initiate(params: InitiateParams): Promise<InitiateResult> {
    const token = await getAccessToken();

    const response = await fetch(`${OM_API_URL}/webpayment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        merchant_key: OM_MERCHANT_KEY,
        currency: params.currency,
        order_id: params.paymentId,
        amount: params.amount,
        return_url: params.returnUrl,
        cancel_url: params.returnUrl,
        notif_url: params.callbackUrl,
        lang: "fr",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      // P1-11 — body NOT concatenated into the error message. Logged
      // separately via `logProviderError` so the user-facing surface
      // never carries provider-internal traces.
      const body = await response.text().catch(() => "");
      logProviderError({
        providerName: "orange_money",
        operation: "initiate",
        httpStatus: response.status,
        body,
        paymentId: params.paymentId,
      });
      throw new ProviderError({
        providerName: "orange_money",
        httpStatus: response.status,
      });
    }

    // P1-10 (audit C4) — raw OM response carries `notif_token`, the
    // pre-shared symmetric secret OM uses to sign callbacks. Never
    // store, log, or pass it downstream — explicitly delete it before
    // the parsed body can be touched by anything else, and narrow the
    // typed view so callers can't reach for it without changing this
    // file. Invariant: `notif_token` is configured server-side (env
    // var ORANGE_MONEY_NOTIF_TOKEN), so we already know it; the API
    // copy is redundant and dangerous.
    const raw = (await response.json()) as Record<string, unknown>;
    if ("notif_token" in raw) {
      delete raw.notif_token;
    }
    const data = raw as { pay_token?: unknown; payment_url?: unknown };
    if (typeof data.pay_token !== "string" || typeof data.payment_url !== "string") {
      logProviderError({
        providerName: "orange_money",
        operation: "initiate.parse",
        httpStatus: response.status,
        body: "missing pay_token / payment_url",
        paymentId: params.paymentId,
      });
      throw new ProviderError({
        providerName: "orange_money",
        httpStatus: response.status,
        providerCode: "malformed_response",
      });
    }

    return {
      providerTransactionId: data.pay_token,
      redirectUrl: data.payment_url,
    };
  }

  async verify(providerTransactionId: string): Promise<VerifyResult> {
    const token = await getAccessToken();

    const response = await fetch(`${OM_API_URL}/transactionstatus`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pay_token: providerTransactionId,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return { status: "failed", metadata: { reason: `OM verify failed: ${response.status}` } };
    }

    const data = (await response.json()) as { status: string };

    const statusMap: Record<string, "succeeded" | "failed" | "pending"> = {
      SUCCESS: "succeeded",
      FAILED: "failed",
      EXPIRED: "failed",
      CANCELLED: "failed",
      INITIATED: "pending",
      PENDING: "pending",
    };

    return {
      status: statusMap[data.status] ?? "pending",
      metadata: data as unknown as Record<string, unknown>,
    };
  }

  async refund(_providerTransactionId: string, _amount: number): Promise<RefundResult> {
    // Orange Money does not support programmatic refunds via API.
    // Refunds must be processed manually via the Orange Money merchant
    // portal. Tag the reason so the payment service can surface a
    // specific operator-facing message instead of the generic
    // "provider refused" string.
    return { success: false, reason: "manual_refund_required" };
  }

  /**
   * Verify Orange Money webhook notification token.
   * OM sends a pre-shared symmetric token on each webhook as a custom
   * header; we compare it constant-time against the configured value.
   * Accepts both `x-om-token` and `notif_token` header names — OM's
   * API went through several rebrandings.
   */
  verifyWebhook(params: VerifyWebhookParams): boolean {
    if (!OM_NOTIF_TOKEN) return false;
    const received =
      readHeaderOm(params.headers, "x-om-token") ??
      readHeaderOm(params.headers, "notif_token") ??
      readHeaderOm(params.headers, "x-notif-token");
    if (!received) return false;
    return OrangeMoneyPaymentProvider.verifyNotifToken(received, OM_NOTIF_TOKEN);
  }

  /**
   * Verify Orange Money webhook notification token.
   */
  static verifyNotifToken(receivedToken: string, expectedToken: string): boolean {
    if (!receivedToken || !expectedToken) return false;
    if (receivedToken.length !== expectedToken.length) return false;
    return crypto.timingSafeEqual(Buffer.from(receivedToken), Buffer.from(expectedToken));
  }
}

function readHeaderOm(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const v = headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export const orangeMoneyPaymentProvider = new OrangeMoneyPaymentProvider();
