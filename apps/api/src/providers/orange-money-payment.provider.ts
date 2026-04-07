import crypto from "node:crypto";
import {
  type PaymentProvider,
  type InitiateParams,
  type InitiateResult,
  type VerifyResult,
  type RefundResult,
} from "./payment-provider.interface";

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

const OM_API_URL = process.env.ORANGE_MONEY_API_URL ?? "https://api.orange.com/orange-money-webpay/dev/v1";
const OM_CLIENT_ID = process.env.ORANGE_MONEY_CLIENT_ID ?? "";
const OM_CLIENT_SECRET = process.env.ORANGE_MONEY_CLIENT_SECRET ?? "";
const OM_MERCHANT_KEY = process.env.ORANGE_MONEY_MERCHANT_KEY ?? "";

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
    throw new Error(`Orange Money OAuth error: ${response.status}`);
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
      const body = await response.text();
      throw new Error(`Orange Money API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      pay_token: string;
      payment_url: string;
      notif_token: string;
    };

    return {
      providerTransactionId: data.pay_token,
      redirectUrl: data.payment_url,
    };
  }

  async verify(providerTransactionId: string): Promise<VerifyResult> {
    const token = await getAccessToken();

    const response = await fetch(
      `${OM_API_URL}/transactionstatus`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pay_token: providerTransactionId,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

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
    // Refunds must be processed manually via the Orange Money merchant portal.
    return { success: false };
  }

  /**
   * Verify Orange Money webhook notification token.
   */
  static verifyNotifToken(receivedToken: string, expectedToken: string): boolean {
    if (!receivedToken || !expectedToken) return false;
    if (receivedToken.length !== expectedToken.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(receivedToken),
      Buffer.from(expectedToken),
    );
  }
}

export const orangeMoneyPaymentProvider = new OrangeMoneyPaymentProvider();
