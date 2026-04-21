import crypto from "crypto";
import { paymentMockCheckoutUrl } from "@/config/public-urls";
import {
  type PaymentProvider,
  type InitiateParams,
  type InitiateResult,
  type VerifyResult,
  type RefundResult,
  type VerifyWebhookParams,
} from "./payment-provider.interface";

// Re-declared locally to avoid a circular import via payment.service.
// Must stay in sync with payment.service.WEBHOOK_SECRET.
const WEBHOOK_SECRET =
  process.env.PAYMENT_WEBHOOK_SECRET ??
  (process.env.NODE_ENV === "production" ? "" : "dev-webhook-secret-change-in-prod");

/**
 * Mock payment provider for development and testing.
 *
 * Simulates the mobile money flow:
 * 1. `initiate()` stores a pending payment and returns a mock checkout URL
 * 2. The mock checkout page (served by a route) lets the tester click "Payer" or "Annuler"
 * 3. That click hits the webhook endpoint, confirming or failing the payment
 * 4. `verify()` returns the current status from the in-memory store
 *
 * In production, this is replaced by WavePaymentProvider, OrangeMoneyProvider, etc.
 */

interface MockPaymentState {
  status: "pending" | "succeeded" | "failed";
  amount: number;
  /** User-selected payment method — drives the mock checkout branding. */
  method: string;
  metadata: Record<string, unknown>;
}

// In-memory store for mock payment states
const paymentStore = new Map<string, MockPaymentState>();

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async initiate(params: InitiateParams): Promise<InitiateResult> {
    const providerTransactionId = `mock_${crypto.randomBytes(12).toString("hex")}`;

    paymentStore.set(providerTransactionId, {
      status: "pending",
      amount: params.amount,
      method: params.method ?? "mock",
      metadata: {
        paymentId: params.paymentId,
        description: params.description,
        callbackUrl: params.callbackUrl,
        returnUrl: params.returnUrl,
        method: params.method ?? "mock",
      },
    });

    // The mock checkout page is served by the API at /v1/payments/mock-checkout/:txId
    const redirectUrl = paymentMockCheckoutUrl(providerTransactionId);

    return { providerTransactionId, redirectUrl };
  }

  async verify(providerTransactionId: string): Promise<VerifyResult> {
    const state = paymentStore.get(providerTransactionId);
    if (!state) {
      return { status: "failed", metadata: { reason: "Transaction inconnue" } };
    }
    return { status: state.status, metadata: state.metadata };
  }

  async refund(providerTransactionId: string, amount: number): Promise<RefundResult> {
    const state = paymentStore.get(providerTransactionId);
    if (!state || state.status !== "succeeded") {
      return { success: false };
    }
    // Don't change status here — PaymentService handles status transitions
    state.metadata.refundedAmount = amount;
    return {
      success: true,
      providerRefundId: `mock_refund_${crypto.randomBytes(6).toString("hex")}`,
    };
  }

  /**
   * Simulate a payment completion (called by mock checkout route).
   * In production, this is handled by the provider's webhook.
   */
  static simulateCallback(
    providerTransactionId: string,
    success: boolean,
  ): MockPaymentState | null {
    const state = paymentStore.get(providerTransactionId);
    if (!state) return null;
    state.status = success ? "succeeded" : "failed";
    return state;
  }

  /** Get mock payment state (for the checkout page) */
  static getState(providerTransactionId: string): MockPaymentState | null {
    return paymentStore.get(providerTransactionId) ?? null;
  }

  /**
   * Mock-provider webhook verification — HMAC of raw body keyed by
   * PAYMENT_WEBHOOK_SECRET, passed as `X-Webhook-Signature`. This is
   * what the dev-only mock-checkout page uses. Never enabled in
   * production: the `getProvider("mock")` path throws in production
   * before this is even called.
   */
  verifyWebhook(params: VerifyWebhookParams): boolean {
    if (!WEBHOOK_SECRET) return false;
    const signature = readMockHeader(params.headers, "x-webhook-signature");
    if (!signature) return false;
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(params.rawBody)
      .digest("hex");
    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
}

function readMockHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const v = headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export const mockPaymentProvider = new MockPaymentProvider();
