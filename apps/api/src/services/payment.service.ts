import crypto from "node:crypto";
import {
  type Payment,
  type PaymentStatus,
  type PaymentMethod,
  type PaymentSummary,
  type Registration,
  type Event,
  isAdminSystemRole,
} from "@teranga/shared-types";
import { paymentRepository } from "@/repositories/payment.repository";
import { eventRepository } from "@/repositories/event.repository";
import { db, COLLECTIONS } from "@/config/firebase";
import { FieldValue } from "@/repositories/transaction.helper";
import { type AuthUser } from "@/middlewares/auth.middleware";
import {
  ValidationError,
  ConflictError,
  DuplicateRegistrationError,
  NotFoundError,
  RegistrationClosedError,
  EventFullError,
} from "@/errors/app-error";
import { BaseService } from "./base.service";
import { signQrPayload, signQrPayloadV4, computeValidityWindow } from "./qr-signing";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { type PaymentProvider } from "@/providers/payment-provider.interface";
import { mockPaymentProvider } from "@/providers/mock-payment.provider";
import { wavePaymentProvider } from "@/providers/wave-payment.provider";
import { orangeMoneyPaymentProvider } from "@/providers/orange-money-payment.provider";
import { computePlatformFee, computeAvailableOn } from "@/config/finance";
import { getOwnedWebHosts, paymentReturnUrl, paymentWebhookUrl } from "@/config/public-urls";
import { appendLedgerEntry } from "./balance-ledger";

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

/**
 * Route-facing lookup for the webhook verifier path. Returns `null` when
 * the provider string doesn't match a registered provider — callers
 * translate null into a 404 rather than leaking the registry shape via
 * an exception. Allows mock in production only if `NODE_ENV !== "production"`,
 * matching `getProvider` semantics.
 */
export function getProviderForWebhook(providerName: string): PaymentProvider | null {
  const provider = providers[providerName as PaymentMethod];
  if (!provider) return null;
  if (IS_PROD && providerName === "mock") return null;
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

// ─── returnUrl allowlist ────────────────────────────────────────────────────
//
// After the user completes payment, the provider redirects their browser
// to `returnUrl`. Accepting any http(s) URL would turn us into an open
// redirect chained off a trust-worthy Wave/OM checkout — a classic
// phishing amplifier. Allow only hosts the platform itself owns (from
// config/public-urls.getOwnedWebHosts), plus anything explicitly
// allow-listed via ALLOWED_RETURN_HOSTS (comma-separated) for one-off
// exceptions (e.g. a partner domain during a campaign).

function getAllowedReturnHosts(): Set<string> {
  const hosts = new Set<string>(getOwnedWebHosts());
  (process.env.ALLOWED_RETURN_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((h) => hosts.add(h.toLowerCase()));
  return hosts;
}

function assertAllowedReturnUrl(returnUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    throw new ValidationError("L'URL de retour est mal formée");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("L'URL de retour doit utiliser HTTP ou HTTPS");
  }
  const allowed = getAllowedReturnHosts();
  if (!allowed.has(parsed.host.toLowerCase())) {
    throw new ValidationError(
      `L'URL de retour ${parsed.host} n'est pas autorisée. Utilisez un domaine de la plateforme.`,
    );
  }
  return returnUrl;
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
      const reason =
        event.status === "cancelled"
          ? "event_cancelled"
          : event.status === "completed"
            ? "event_completed"
            : event.status === "archived"
              ? "event_archived"
              : "event_not_published";
      throw new RegistrationClosedError(eventId, reason);
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
    // QR signing: v4 (per-event `kid` + HKDF-derived key) when the event
    // has migrated to the new signing scheme; v3 fallback for legacy
    // events whose docs predate the `qrKid` field.
    const qrWindow = computeValidityWindow(event.startDate, event.endDate);
    const qrCodeValue = event.qrKid
      ? signQrPayloadV4(
          regId,
          eventId,
          user.uid,
          qrWindow.notBefore,
          qrWindow.notAfter,
          event.qrKid,
        )
      : signQrPayload(regId, eventId, user.uid, qrWindow.notBefore, qrWindow.notAfter);

    // Webhook path encodes the provider so the endpoint can route to
    // the correct signature verifier without a query-string sniff.
    const callbackUrl = paymentWebhookUrl(method);
    const defaultReturnUrl = paymentReturnUrl(eventId, payId);
    const finalReturnUrl = returnUrl ? assertAllowedReturnUrl(returnUrl) : defaultReturnUrl;

    // Get provider and initiate (outside transaction — provider call is idempotent)
    const provider = getProvider(method);
    const { providerTransactionId, redirectUrl } = await provider.initiate({
      paymentId: payId,
      amount: ticketType.price,
      currency: "XOF",
      description: `Inscription : ${event.title} — ${ticketType.name}`,
      callbackUrl,
      returnUrl: finalReturnUrl,
      method,
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
        throw new DuplicateRegistrationError(eventId);
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

        // P1-04 (audit H5) — merge the two `tx.update(eventRef, ...)`
        // calls into one. Firestore merges sequential updates on the
        // same ref within a tx, but the previous split-into-two pattern
        // was fragile — any future code that introduces a third update
        // would silently lose fields if the field set overlapped.
        //
        // The `ticketTypes` array rewrite is computed from the
        // transactional read at `eventSnap`, so the write is consistent
        // with the read. INVARIANT: `ticketTypes[].soldCount` MUST
        // ONLY ever be mutated inside a Firestore transaction whose
        // read of the parent event doc is inside the same tx.
        // Any future non-transactional path that touches
        // `ticketTypes[]` will silently drop concurrent increments.
        // (Phase-3 candidate: model ticketTypes as a subcollection so
        // FieldValue.increment can target nested fields.)
        const eventUpdate: Record<string, unknown> = {
          registeredCount: FieldValue.increment(1),
          updatedAt: now,
        };
        if (eventData) {
          const reg = regSnap.data() as Registration;
          eventUpdate.ticketTypes = eventData.ticketTypes.map((tt) =>
            tt.id === reg.ticketTypeId ? { ...tt, soldCount: tt.soldCount + 1 } : tt,
          );
        }
        tx.update(eventRef, eventUpdate);

        // ── Ledger entries ─────────────────────────────────────────────
        // Writes `payment` (+amount) + `platform_fee` (−fee) inside the
        // same transaction that confirms the payment. Two entries rather
        // than one net entry so the UI can show gross revenue and total
        // fees independently without recomputing from raw payments.
        //
        // Attribution fields read from `freshPayment` — the transactional
        // re-read — so tenant scope (organizationId/eventId/paymentId)
        // can never drift from whatever else the transaction commits.
        const platformFee = computePlatformFee(freshPayment.amount);
        const availableOn = computeAvailableOn(
          now,
          eventData?.endDate ?? eventData?.startDate ?? null,
        );
        const description = `Billet : ${eventData?.title ?? freshPayment.eventId}`;

        appendLedgerEntry(tx, {
          organizationId: freshPayment.organizationId,
          eventId: freshPayment.eventId,
          paymentId: freshPayment.id,
          payoutId: null,
          kind: "payment",
          amount: freshPayment.amount,
          status: "pending",
          availableOn,
          description,
          createdBy: "system:payment.webhook",
          createdAt: now,
        });
        if (platformFee > 0) {
          appendLedgerEntry(tx, {
            organizationId: freshPayment.organizationId,
            eventId: freshPayment.eventId,
            paymentId: freshPayment.id,
            payoutId: null,
            kind: "platform_fee",
            amount: -platformFee,
            status: "pending",
            availableOn,
            description: `Frais plateforme (${Math.round(
              (platformFee / freshPayment.amount) * 100,
            )}%)`,
            createdBy: "system:payment.webhook",
            createdAt: now,
          });
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
    if (payment.userId !== user.uid && !user.roles.some(isAdminSystemRole)) {
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

    // ─── Concurrent-refund lock (pre-provider call) ───────────────────────
    // Atomically claim the refund-in-flight lock for this paymentId. If a
    // concurrent refund is already mid-flight, `create()` throws with the
    // gRPC ALREADY_EXISTS code (6) and we reject before touching the
    // provider. Without this, two simultaneous "Refund" clicks both
    // passed the outer guard and both hit the provider — only the DB
    // write deduplicated, leaving the provider with two refund records.
    // Lock is released after the DB transaction commits (success path) or
    // after provider failure (catch path). A stale-sweep job can purge
    // anything older than the provider timeout (30 s) as a safety net.
    // P1-02 (audit M1) — Refund lock with TTL-based stale recovery.
    //
    // The lock prevents two concurrent refund flows from both calling
    // the provider. It's released inside the success-path transaction
    // (`tx.delete(lockRef)` at the end of `runTransaction`) so the
    // lock lifecycle is tied to DB commit, not provider success.
    //
    // The remaining failure mode is process crash between
    // `lockRef.create()` here and either the provider call or the tx —
    // the lock would otherwise stay forever and block every subsequent
    // refund on this payment. Mitigations:
    //
    //   1. `expiresAt` = now + 5 min on the lock doc. The provider
    //      timeout is 30 s and the tx commits in seconds, so any
    //      lock older than 5 min is conclusively stale.
    //   2. TTL policy on `expiresAt` (configured in
    //      firestore.indexes.json TTL section) — Firestore auto-purges
    //      docs whose TTL field is in the past, free + zero-ops.
    //   3. Defensive recovery on 409: if the existing lock is stale,
    //      a concurrent transaction replaces it and retries the create.
    //      Bounds worst-case operator-perceived stuck time to 5 min
    //      even if the TTL purge is delayed.
    const lockRef = db.collection(COLLECTIONS.REFUND_LOCKS).doc(paymentId);
    const lockTtlMs = 5 * 60 * 1000;
    const lockNow = new Date();
    const lockExpiresAt = new Date(lockNow.getTime() + lockTtlMs);
    const tryAcquireLock = async () => {
      await lockRef.create({
        paymentId,
        refundAmount,
        actorId: user.uid,
        createdAt: lockNow.toISOString(),
        expiresAt: lockExpiresAt.toISOString(),
      });
    };
    try {
      await tryAcquireLock();
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === 6) {
        // Stale-lock recovery — atomically replace any lock whose
        // `expiresAt` is already in the past. Concurrent recoverers
        // contend on the same tx; the loser sees a fresh lock and 409s.
        const recovered = await db.runTransaction(async (tx) => {
          const existing = await tx.get(lockRef);
          if (!existing.exists) return false;
          const data = existing.data() as { expiresAt?: string };
          const exp = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
          if (exp > Date.now()) return false; // genuine in-flight lock — give up
          tx.delete(lockRef);
          tx.create(lockRef, {
            paymentId,
            refundAmount,
            actorId: user.uid,
            createdAt: lockNow.toISOString(),
            expiresAt: lockExpiresAt.toISOString(),
            recoveredFromStale: true,
          });
          return true;
        });
        if (!recovered) {
          throw new ConflictError(
            "Un remboursement est déjà en cours pour ce paiement. Réessayez dans quelques secondes.",
          );
        }
      } else {
        throw err;
      }
    }

    // Call provider refund
    const provider = getProvider(payment.method);
    let result: { success: boolean; reason?: string };
    try {
      result = await provider.refund(payment.providerTransactionId!, refundAmount);
    } catch (err) {
      // Release the lock on provider exception so subsequent retries can
      // attempt the refund without waiting for the sweep job.
      await lockRef.delete().catch(() => {});
      throw err;
    }
    if (!result.success) {
      // Notify the customer-facing "refund failed" template BEFORE
      // throwing. Emits `refund.failed` so the dispatcher listener
      // routes to the dedicated copy ("we couldn't process your refund
      // — contact support"). Separate emit from the thrown error so
      // dispatch stays fire-and-forget.
      const failureNow = new Date().toISOString();
      eventBus.emit("refund.failed", {
        paymentId,
        registrationId: payment.registrationId,
        eventId: payment.eventId,
        organizationId: payment.organizationId,
        amount: refundAmount,
        failureReason: result.reason ?? "provider_refused",
        actorId: user.uid,
        requestId: getRequestId(),
        timestamp: failureNow,
      });

      // Surface the specific reason when the provider tags it. Orange
      // Money in particular never supports programmatic refunds — the
      // operator has to process the refund via their OM merchant
      // portal, so a generic "provider refused" error would be
      // misleading and unhelpful.
      if (result.reason === "manual_refund_required") {
        throw new ValidationError(
          "Ce fournisseur de paiement ne prend pas en charge les remboursements automatiques. " +
            "Contactez votre point de vente Orange Money ou effectuez le remboursement manuel " +
            "depuis le portail marchand. Marquez ensuite l'inscription comme annulée.",
        );
      }
      throw new ValidationError("Le remboursement a été refusé par le fournisseur");
    }

    const now = new Date().toISOString();

    // Atomic update: payment + registration + event counter + ledger +
    // refund-lock release.
    //
    // Defense-in-depth for concurrent refunds:
    //   1. Pre-call lock at `refundLocks/{paymentId}` via `ref.create()`
    //      — first caller wins, second gets 409 before touching the
    //      provider. Provider is hit at most once per (payment) at a time.
    //   2. In-transaction fresh re-read — protects against the lock
    //      being stale / missed (e.g. manual deletion) by checking
    //      `payment.status` + `refundedAmount` again against a fresh
    //      snapshot and aborting if the state has drifted.
    //   3. Lock release is inside this transaction — tied to the DB
    //      commit, so a retry on contention doesn't release a lock that
    //      still protects an in-flight provider call.
    let isFullRefund = false;
    await db.runTransaction(async (tx) => {
      const payRef = db.collection(COLLECTIONS.PAYMENTS).doc(paymentId);
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists) throw new NotFoundError("Payment", paymentId);
      const freshPayment = paySnap.data() as Payment;

      // Re-validate against fresh state — a concurrent refund may have
      // completed between the outer read and this transaction.
      if (freshPayment.status === "refunded") {
        throw new ValidationError("Ce paiement a déjà été intégralement remboursé");
      }
      if (freshPayment.status !== "succeeded") {
        throw new ValidationError("Seul un paiement confirmé peut être remboursé");
      }
      const remaining = freshPayment.amount - freshPayment.refundedAmount;
      if (refundAmount > remaining) {
        throw new ValidationError("Le montant du remboursement dépasse le solde restant");
      }

      const newRefundedAmount = freshPayment.refundedAmount + refundAmount;
      isFullRefund = newRefundedAmount === freshPayment.amount;

      tx.update(payRef, {
        status: isFullRefund ? ("refunded" as PaymentStatus) : freshPayment.status,
        refundedAmount: newRefundedAmount,
        updatedAt: now,
      });

      if (isFullRefund) {
        // P1-03 (audit H4) — Full refund must decrement BOTH
        // `event.registeredCount` AND the per-ticket-type `soldCount`,
        // in the SAME transaction. Decrementing only `registeredCount`
        // (the previous behaviour) caused a slow-burn drift between
        // the event-level counter and `sum(ticketTypes[].soldCount)`,
        // which surfaced as spurious `EventFullError`s on subsequent
        // registrations because the per-ticket-type counter was
        // artificially inflated.
        //
        // We read the registration to recover the original
        // `ticketTypeId`, then read the event to mutate its
        // `ticketTypes` array. Both reads happen here — Firestore tx
        // semantics require all reads before any writes.
        const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(freshPayment.registrationId);
        const eventRef = db.collection(COLLECTIONS.EVENTS).doc(freshPayment.eventId);

        // Reads (must precede writes per Firestore tx rules).
        const [regSnap, eventSnap] = await Promise.all([tx.get(regRef), tx.get(eventRef)]);
        if (!regSnap.exists) {
          throw new NotFoundError("Registration", freshPayment.registrationId);
        }
        if (!eventSnap.exists) {
          throw new NotFoundError("Event", freshPayment.eventId);
        }
        const reg = regSnap.data() as { ticketTypeId?: string };
        const eventData = eventSnap.data() as {
          ticketTypes?: Array<{ id: string; soldCount?: number }>;
        };

        // Defensive: rebuild the ticketTypes array with the matching
        // type's soldCount decremented (clamped at 0 — never negative).
        // We don't use `FieldValue.increment` on the nested field
        // because `ticketTypes` is stored as a Firestore array, not a
        // map; nested-field increment requires map-typed parents.
        // The array-rebuild pattern is safe here because we're inside
        // a tx whose read at `eventSnap` is consistent with this
        // write — see P1-04 for the parallel hardening on the
        // webhook-success path that uses the same pattern.
        let updatedTicketTypes: typeof eventData.ticketTypes;
        if (Array.isArray(eventData.ticketTypes) && reg.ticketTypeId) {
          const targetId = reg.ticketTypeId;
          updatedTicketTypes = eventData.ticketTypes.map((tt) =>
            tt.id === targetId
              ? { ...tt, soldCount: Math.max(0, (tt.soldCount ?? 0) - 1) }
              : tt,
          );
        }

        // Writes — registration cancel + event counter decrement +
        // ticketTypes array rebuild, all in one tx.update on each ref.
        tx.update(regRef, {
          status: "cancelled",
          updatedAt: now,
        });
        const eventUpdate: Record<string, unknown> = {
          registeredCount: FieldValue.increment(-1),
          updatedAt: now,
        };
        if (updatedTicketTypes) {
          eventUpdate.ticketTypes = updatedTicketTypes;
        }
        tx.update(eventRef, eventUpdate);
      }

      // ── Ledger entry ───────────────────────────────────────────────────
      // Refunds debit the balance immediately (status=available) — they
      // don't wait for the T+N release window. Matches Stripe behaviour
      // and matches operator intuition: if the customer got their money
      // back, the org's balance went down RIGHT NOW.
      //
      // Attribution fields (organizationId, eventId, paymentId) come from
      // `freshPayment` — the transactional re-read — not the outer stale
      // snapshot. `organizationId` / `eventId` are immutable on payments
      // today so this is belt-and-suspenders; it also matches the pattern
      // established in handleWebhook() and keeps tenant-scope attribution
      // defensible in the face of future Admin-SDK migrations.
      appendLedgerEntry(tx, {
        organizationId: freshPayment.organizationId,
        eventId: freshPayment.eventId,
        paymentId: freshPayment.id,
        payoutId: null,
        kind: "refund",
        amount: -refundAmount,
        status: "available",
        availableOn: now,
        description: reason ? `Remboursement : ${reason}` : "Remboursement",
        createdBy: user.uid,
        createdAt: now,
      });

      // Release the refund-in-flight lock inside the SAME transaction
      // that commits the ledger write. Ties lock release to DB success —
      // if the transaction aborts (retry / contention), the lock stays
      // and the next attempt cleanly rejects concurrent callers.
      tx.delete(lockRef);
    });

    // Generic audit / state-transition event — fires on every successful
    // refund regardless of template routing. Kept so audit consumers,
    // accounting exports, and the admin-facing timeline don't have to
    // track the new refund-specific events.
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

    // Notification trigger — dispatcher listener routes this to the
    // customer-facing `refund.issued` template. Separate from
    // `payment.refunded` per the Phase 2 notification catalog split so
    // the failure path (`refund.failed`) can drive its own template
    // with distinct copy without branching off `payment.refunded`.
    eventBus.emit("refund.issued", {
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
