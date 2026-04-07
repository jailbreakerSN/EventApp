import crypto from "node:crypto";
import {
  type PaymentProvider,
  type InitiateParams,
  type InitiateResult,
  type VerifyResult,
  type RefundResult,
} from "./payment-provider.interface";

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
      const body = await response.text();
      throw new Error(`Wave API error (${response.status}): ${body}`);
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
    const response = await fetch(
      `${WAVE_API_URL}/checkout/sessions/${providerTransactionId}`,
      {
        headers: { Authorization: `Bearer ${WAVE_API_KEY}` },
        signal: AbortSignal.timeout(30_000),
      },
    );

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
    const response = await fetch(`${WAVE_API_URL}/refunds`, {
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

    if (!response.ok) {
      return { success: false };
    }

    const data = (await response.json()) as { id: string };
    return { success: true, providerRefundId: data.id };
  }

  /**
   * Verify Wave webhook signature.
   * Wave signs webhooks with HMAC-SHA256 using the API secret.
   */
  static verifySignature(body: string, signature: string): boolean {
    if (!WAVE_API_SECRET) return false;
    const expected = crypto
      .createHmac("sha256", WAVE_API_SECRET)
      .update(body)
      .digest("hex");
    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
}

export const wavePaymentProvider = new WavePaymentProvider();
