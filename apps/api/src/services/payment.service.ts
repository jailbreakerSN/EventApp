import crypto from "node:crypto";
import {
  type Payment,
  type PaymentStatus,
  type PaymentMethod,
  type PaymentSummary,
  type Registration,
  type Event,
} from "@teranga/shared-types";
import { paymentRepository } from "@/repositories/payment.repository";
import { eventRepository } from "@/repositories/event.repository";
import { db, COLLECTIONS } from "@/config/firebase";
import { FieldValue } from "@/repositories/transaction.helper";
import { type AuthUser } from "@/middlewares/auth.middleware";
import {
  ValidationError,
  ConflictError,
  NotFoundError,
  RegistrationClosedError,
  EventFullError,
} from "@/errors/app-error";
import { BaseService } from "./base.service";
import { signQrPayload } from "./qr-signing";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { type PaymentProvider } from "@/providers/payment-provider.interface";
import { mockPaymentProvider } from "@/providers/mock-payment.provider";
import { wavePaymentProvider } from "@/providers/wave-payment.provider";
import { orangeMoneyPaymentProvider } from "@/providers/orange-money-payment.provider";

// ─── Provider Registry ──────────────────────────────────────────────────────

/**
 * Provider routing:
 * - In production (when API keys are set), routes to real providers
 * - In development, falls back to mock provider for all methods
 */
const IS_PROD = process.env.NODE_ENV === "production";
const HAS_WAVE = !!process.env.WAVE_API_KEY;
const HAS_OM = !!process.env.ORANGE_MONEY_CLIENT_ID;

const providers: Record<string, PaymentProvider> = {
  mock: mockPaymentProvider,
  wave: HAS_WAVE ? wavePaymentProvider : mockPaymentProvider,
  orange_money: HAS_OM ? orangeMoneyPaymentProvider : mockPaymentProvider,
  free_money: mockPaymentProvider, // TODO: implement when Free Money API available
  card: mockPaymentProvider, // TODO: implement with PayDunya/Stripe
};

function getProvider(method: PaymentMethod): PaymentProvider {
  const provider = providers[method];
  if (!provider) {
    throw new ValidationError(`Méthode de paiement « ${method} » non disponible`);
  }
  // In production, block mock method
  if (IS_PROD && method === "mock") {
    throw new ValidationError("Le mode test n'est pas disponible en production");
  }
  return provider;
}

// ─── Webhook Signature ──────────────────────────────────────────────────────

const WEBHOOK_SECRET =
  process.env.PAYMENT_WEBHOOK_SECRET ??
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new ValidationError("PAYMENT_WEBHOOK_SECRET is required in production");
      })()
    : "dev-webhook-secret-change-in-prod");

/**
 * Generate HMAC-SHA256 signature for webhook payload verification.
 * Used by mock provider; real providers use their own signing.
 */
export function signWebhookPayload(body: string): string {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

/**
 * Verify webhook signature using timing-safe comparison.
 */
export function verifyWebhookSignature(body: string, signature: string): boolean {
  const expected = signWebhookPayload(body);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ─── Service ────────────────────────────────────────────────────────────────

export class PaymentService extends BaseService {
  /**
   * Initiate a payment for a paid ticket.
   *
   * Uses a Firestore transaction for the duplicate check + document creation
   * to prevent race conditions from concurrent requests.
   */
  async initiatePayment(
    eventId: string,
    ticketTypeId: string,
    method: PaymentMethod,
    returnUrl: string | undefined,
    user: AuthUser,
  ): Promise<{ paymentId: string; redirectUrl: string }> {
    this.requirePermission(user, "payment:initiate");

    // ── Read event ──
    const event = await eventRepository.findByIdOrThrow(eventId);

    if (event.status !== "published") {
      throw new RegistrationClosedError(eventId);
    }

    // ── Validate ticket type ──
    const ticketType = event.ticketTypes.find((t) => t.id === ticketTypeId);
    if (!ticketType) {
      throw new ValidationError(`Type de billet « ${ticketTypeId} » introuvable`);
    }

    if (ticketType.price <= 0) {
      throw new ValidationError("Ce billet est gratuit. Utilisez l'inscription classique.");
    }

    // ── Check availability ──
    if (ticketType.totalQuantity !== null && ticketType.soldCount >= ticketType.totalQuantity) {
      throw new EventFullError(eventId);
    }
    if (event.maxAttendees && event.registeredCount >= event.maxAttendees) {
      throw new EventFullError(eventId);
    }

    // ── Prepare references and provider call ──
    const now = new Date().toISOString();
    const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc();
    const payRef = db.collection(COLLECTIONS.PAYMENTS).doc();
    const regId = regRef.id;
    const payId = payRef.id;
    const qrCodeValue = signQrPayload(regId, eventId, user.uid);

    const callbackUrl = `${process.env.API_BASE_URL ?? "http://localhost:3000"}/v1/payments/webhook`;
    const finalReturnUrl =
      returnUrl ??
      `${process.env.PARTICIPANT_WEB_URL ?? "http://localhost:3002"}/register/${eventId}/payment-status?paymentId=${payId}`;

    // Get provider and initiate (outside transaction — provider call is idempotent)
    const provider = getProvider(method);
    const { providerTransactionId, redirectUrl } = await provider.initiate({
      paymentId: payId,
      amount: ticketType.price,
      currency: "XOF",
      description: `Inscription : ${event.title} — ${ticketType.name}`,
      callbackUrl,
      returnUrl: finalReturnUrl,
    });

    // ── Atomic: check duplicate + create registration + payment ──
    await db.runTransaction(async (tx) => {
      // Re-check for duplicate inside transaction to prevent race conditions
      const dupeSnap = await tx.get(
        db
          .collection(COLLECTIONS.REGISTRATIONS)
          .where("eventId", "==", eventId)
          .where("userId", "==", user.uid)
          .where("status", "in", ["confirmed", "pending", "pending_payment", "waitlisted"])
          .limit(1),
      );
      if (!dupeSnap.empty) {
        throw new ConflictError("Vous êtes déjà inscrit(e) à cet événement");
      }

      const registration = {
        id: regId,
        eventId,
        userId: user.uid,
        ticketTypeId,
        eventTitle: event.title,
        ticketTypeName: ticketType.name,
        status: "pending_payment",
        qrCodeValue,
        checkedInAt: null,
        checkedInBy: null,
        accessZoneId: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
      };

      const payment: Payment = {
        id: payId,
        registrationId: regId,
        eventId,
        organizationId: event.organizationId,
        userId: user.uid,
        amount: ticketType.price,
        currency: "XOF",
        method,
        providerTransactionId,
        status: "processing",
        redirectUrl,
        callbackUrl,
        returnUrl: finalReturnUrl,
        providerMetadata: null,
        failureReason: null,
        refundedAmount: 0,
        initiatedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      } as Payment;

      tx.set(regRef, registration);
      tx.set(payRef, payment);
    });

    eventBus.emit("payment.initiated", {
      paymentId: payId,
      registrationId: regId,
      eventId,
      organizationId: event.organizationId,
      amount: ticketType.price,
      method,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return { paymentId: payId, redirectUrl };
  }

  /**
   * Handle webhook callback from payment provider.
   *
   * All state transitions happen inside a single Firestore transaction
   * for both success and failure paths, ensuring atomicity and idempotency.
   */
  async handleWebhook(
    providerTransactionId: string,
    providerStatus: "succeeded" | "failed",
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const payment = await paymentRepository.findByProviderTransactionId(providerTransactionId);
    if (!payment) {
      throw new NotFoundError("Payment", providerTransactionId);
    }

    // Quick idempotency check (full check inside transaction below)
    if (
      payment.status === "succeeded" ||
      payment.status === "failed" ||
      payment.status === "refunded"
    ) {
      return;
    }

    const now = new Date().toISOString();

    if (providerStatus === "succeeded") {
      // ── Confirm payment + registration atomically ──
      await db.runTransaction(async (tx) => {
        // Re-read payment inside transaction for true idempotency
        const payRef = db.collection(COLLECTIONS.PAYMENTS).doc(payment.id);
        const paySnap = await tx.get(payRef);
        if (!paySnap.exists) return;
        const freshPayment = paySnap.data() as Payment;

        // Idempotency: skip if already terminal
        if (
          freshPayment.status === "succeeded" ||
          freshPayment.status === "failed" ||
          freshPayment.status === "refunded"
        ) {
          return;
        }

        const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(payment.registrationId);
        const regSnap = await tx.get(regRef);
        if (!regSnap.exists) {
          throw new NotFoundError("Registration", payment.registrationId);
        }

        const eventRef = db.collection(COLLECTIONS.EVENTS).doc(payment.eventId);
        const eventSnap = await tx.get(eventRef);
        const eventData = eventSnap.data() as Event | undefined;

        // Update payment
        tx.update(payRef, {
          status: "succeeded" as PaymentStatus,
          completedAt: now,
          updatedAt: now,
          providerMetadata: metadata ?? null,
        });

        // Confirm registration
        tx.update(regRef, {
          status: "confirmed",
          updatedAt: now,
        });

        // Increment event registeredCount
        tx.update(eventRef, {
          registeredCount: FieldValue.increment(1),
          updatedAt: now,
        });

        // Increment ticketType.soldCount
        if (eventData) {
          const reg = regSnap.data() as Registration;
          const updatedTicketTypes = eventData.ticketTypes.map((tt) =>
            tt.id === reg.ticketTypeId ? { ...tt, soldCount: tt.soldCount + 1 } : tt,
          );
          tx.update(eventRef, { ticketTypes: updatedTicketTypes });
        }
      });

      eventBus.emit("payment.succeeded", {
        paymentId: payment.id,
        registrationId: payment.registrationId,
        eventId: payment.eventId,
        organizationId: payment.organizationId,
        amount: payment.amount,
        actorId: payment.userId,
        requestId: getRequestId(),
        timestamp: now,
      });
    } else {
      // ── Payment failed — atomic update of payment + registration ──
      await db.runTransaction(async (tx) => {
        const payRef = db.collection(COLLECTIONS.PAYMENTS).doc(payment.id);
        const paySnap = await tx.get(payRef);
        if (!paySnap.exists) return;
        const freshPayment = paySnap.data() as Payment;

        if (
          freshPayment.status === "succeeded" ||
          freshPayment.status === "failed" ||
          freshPayment.status === "refunded"
        ) {
          return;
        }

        const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(payment.registrationId);

        tx.update(payRef, {
          status: "failed" as PaymentStatus,
          failureReason: (metadata?.reason as string) ?? "Paiement refusé par le fournisseur",
          updatedAt: now,
          providerMetadata: metadata ?? null,
        });

        tx.update(regRef, {
          status: "cancelled",
          updatedAt: now,
        });
      });

      eventBus.emit("payment.failed", {
        paymentId: payment.id,
        registrationId: payment.registrationId,
        eventId: payment.eventId,
        organizationId: payment.organizationId,
        actorId: payment.userId,
        requestId: getRequestId(),
        timestamp: now,
      });
    }
  }

  /**
   * Get payment status (for polling from frontend).
   */
  async getPaymentStatus(paymentId: string, user: AuthUser): Promise<Payment> {
    this.requirePermission(user, "payment:read_own");
    const payment = await paymentRepository.findByIdOrThrow(paymentId);
    if (payment.userId !== user.uid && !user.roles.includes("super_admin")) {
      this.requirePermission(user, "payment:read_all");
      this.requireOrganizationAccess(user, payment.organizationId);
    }
    return payment;
  }

  /**
   * List payments for an event (organizer view).
   */
  async listEventPayments(
    eventId: string,
    filters: { status?: string; method?: string },
    pagination: { page: number; limit: number },
    user: AuthUser,
  ) {
    this.requirePermission(user, "payment:read_all");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);
    return paymentRepository.findByEvent(eventId, filters, pagination);
  }

  /**
   * Get payment summary for an event (revenue dashboard).
   */
  async getEventPaymentSummary(eventId: string, user: AuthUser): Promise<PaymentSummary> {
    this.requirePermission(user, "payment:view_reports");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const { data: payments } = await paymentRepository.findByEvent(
      eventId,
      {},
      { page: 1, limit: 10000 },
    );

    const summary: PaymentSummary = {
      totalRevenue: 0,
      totalRefunded: 0,
      netRevenue: 0,
      paymentCount: payments.length,
      byStatus: {} as Record<string, number>,
      byMethod: {} as Record<string, number>,
    };

    for (const p of payments) {
      summary.byStatus[p.status] = (summary.byStatus[p.status] ?? 0) + 1;
      summary.byMethod[p.method] = (summary.byMethod[p.method] ?? 0) + 1;
      if (p.status === "succeeded") {
        summary.totalRevenue += p.amount;
      }
      summary.totalRefunded += p.refundedAmount;
    }
    summary.netRevenue = summary.totalRevenue - summary.totalRefunded;

    return summary;
  }

  /**
   * Refund a payment.
   *
   * Uses a transaction for atomic update of payment, registration, and event counter.
   */
  async refundPayment(
    paymentId: string,
    amount: number | undefined,
    reason: string | undefined,
    user: AuthUser,
  ): Promise<Payment> {
    this.requirePermission(user, "payment:refund");

    const payment = await paymentRepository.findByIdOrThrow(paymentId);
    this.requireOrganizationAccess(user, payment.organizationId);

    if (payment.status !== "succeeded") {
      throw new ValidationError("Seul un paiement confirmé peut être remboursé");
    }

    const refundAmount = amount ?? payment.amount;
    if (!Number.isInteger(refundAmount)) {
      throw new ValidationError(
        "Le montant du remboursement doit être un entier (XOF sans décimales)",
      );
    }
    if (refundAmount <= 0) {
      throw new ValidationError("Le montant du remboursement doit être positif");
    }
    if (refundAmount > payment.amount - payment.refundedAmount) {
      throw new ValidationError("Le montant du remboursement dépasse le solde restant");
    }

    // Call provider refund
    const provider = getProvider(payment.method);
    const result = await provider.refund(payment.providerTransactionId!, refundAmount);
    if (!result.success) {
      throw new ValidationError("Le remboursement a été refusé par le fournisseur");
    }

    const now = new Date().toISOString();
    const isFullRefund = refundAmount === payment.amount;

    // Atomic update: payment + registration + event counter
    await db.runTransaction(async (tx) => {
      const payRef = db.collection(COLLECTIONS.PAYMENTS).doc(paymentId);
      tx.update(payRef, {
        status: isFullRefund ? ("refunded" as PaymentStatus) : payment.status,
        refundedAmount: payment.refundedAmount + refundAmount,
        updatedAt: now,
      });

      if (isFullRefund) {
        const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(payment.registrationId);
        tx.update(regRef, {
          status: "cancelled",
          updatedAt: now,
        });

        const eventRef = db.collection(COLLECTIONS.EVENTS).doc(payment.eventId);
        tx.update(eventRef, {
          registeredCount: FieldValue.increment(-1),
          updatedAt: now,
        });
      }
    });

    eventBus.emit("payment.refunded", {
      paymentId,
      registrationId: payment.registrationId,
      eventId: payment.eventId,
      organizationId: payment.organizationId,
      amount: refundAmount,
      reason,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return paymentRepository.findByIdOrThrow(paymentId);
  }
}

export const paymentService = new PaymentService();
