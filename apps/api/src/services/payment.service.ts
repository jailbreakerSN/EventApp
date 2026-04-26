import crypto from "node:crypto";
import {
  type Payment,
  type PaymentClientView,
  type PaymentStatus,
  type PaymentMethod,
  type PaymentSummary,
  type Registration,
  type Event,
  isAdminSystemRole,
} from "@teranga/shared-types";
import { paymentRepository } from "@/repositories/payment.repository";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { db, COLLECTIONS } from "@/config/firebase";
import { FieldValue } from "@/repositories/transaction.helper";
import { type AuthUser } from "@/middlewares/auth.middleware";
import {
  ValidationError,
  ConflictError,
  DuplicateRegistrationError,
  ForbiddenError,
  NotFoundError,
  ProviderError,
  RegistrationClosedError,
  EventFullError,
} from "@/errors/app-error";
import { BaseService } from "./base.service";
import { signQrPayload, signQrPayloadV4, computeValidityWindow } from "./qr-signing";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import {
  type PaymentProvider,
  type RefundResult,
} from "@/providers/payment-provider.interface";
import { mockPaymentProvider } from "@/providers/mock-payment.provider";
import { wavePaymentProvider } from "@/providers/wave-payment.provider";
import { orangeMoneyPaymentProvider } from "@/providers/orange-money-payment.provider";
import { paydunyaPaymentProvider } from "@/providers/paydunya-payment.provider";
import { computePlatformFee, computeAvailableOn } from "@/config/finance";
import { getOwnedWebHosts, paymentReturnUrl, paymentWebhookUrl } from "@/config/public-urls";
import { appendLedgerEntry } from "./balance-ledger";

// ─── Provider Registry ──────────────────────────────────────────────────────

/**
 * Provider routing strategy
 * ─────────────────────────
 *
 * PRIMARY (Phase 2+): PayDunya as a single aggregator fronting Wave /
 * Orange Money / Free Money / card. Activated when `PAYDUNYA_MASTER_KEY`
 * is set (boot assertion enforces all three PayDunya keys are coherent
 * — see `assertProviderSecrets`). One KYC, one webhook format, one
 * channel-routing decision per payment.
 *
 * FALLBACK (legacy direct integrations): Wave + OM direct providers
 * shipped in Phase 1. Kept behind two escape hatches for the
 * 30-day post-cutover rollback window:
 *
 *   1. `LEGACY_PROVIDER=true` env flag — explicit operator override
 *      that disables PayDunya routing even when the keys are set.
 *      Use during a provider incident (PayDunya outage, suspected
 *      key compromise, …) to fail back to direct Wave/OM in seconds.
 *   2. Absent PayDunya keys (`PAYDUNYA_MASTER_KEY` unset) — implicit
 *      fallback used during the gradual roll-out. Same posture as
 *      Phase 1 production.
 *
 * MOCK (development): when neither PayDunya nor the legacy direct
 * keys are configured, every method falls through to
 * `mockPaymentProvider`. Production blocks the mock path via the
 * `IS_PROD && method === "mock"` guard in `getProvider`.
 *
 * Spec: docs-v2/30-api/providers/paydunya.md §1.2.
 */
const IS_PROD = process.env.NODE_ENV === "production";
const HAS_WAVE = !!process.env.WAVE_API_KEY;
const HAS_OM = !!process.env.ORANGE_MONEY_CLIENT_ID;
const HAS_PAYDUNYA = !!process.env.PAYDUNYA_MASTER_KEY;
const LEGACY_PROVIDER = process.env.LEGACY_PROVIDER === "true";
/**
 * Active when PayDunya keys are configured AND the legacy-rollback
 * flag is OFF. The flag is the single source of truth for the
 * "use PayDunya vs use direct" decision so the registry is easy to
 * trace during an incident response.
 */
const PAYDUNYA_ENABLED = HAS_PAYDUNYA && !LEGACY_PROVIDER;

const providers: Record<string, PaymentProvider> = {
  mock: mockPaymentProvider,
  wave: PAYDUNYA_ENABLED
    ? paydunyaPaymentProvider
    : HAS_WAVE
      ? wavePaymentProvider
      : mockPaymentProvider,
  orange_money: PAYDUNYA_ENABLED
    ? paydunyaPaymentProvider
    : HAS_OM
      ? orangeMoneyPaymentProvider
      : mockPaymentProvider,
  free_money: PAYDUNYA_ENABLED ? paydunyaPaymentProvider : mockPaymentProvider,
  card: PAYDUNYA_ENABLED ? paydunyaPaymentProvider : mockPaymentProvider,
  // The `paydunya` key isn't a public PaymentMethod — it's the
  // provider name used by the webhook router so a PayDunya IPN
  // POST'd to `/v1/payments/webhook/paydunya` resolves to the right
  // verifier. Always present (regardless of feature flag) so
  // operators can replay historical webhook events from the admin
  // surface even after rolling back.
  paydunya: paydunyaPaymentProvider,
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
 *
 * Accepts the WebhookProvider name space (which includes `paydunya`,
 * not a member of PaymentMethod). The registry is keyed by string so
 * the lookup is safe regardless of which enum the caller comes from.
 */
export function getProviderForWebhook(providerName: string): PaymentProvider | null {
  const provider = providers[providerName];
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

// ─── Refund failure messages (P1-19) ────────────────────────────────────────
//
// Maps the typed `RefundFailureReason` discriminator (declared in
// `payment-provider.interface.ts`) to French operator-facing copy.
// Each branch carries the actionable guidance the operator needs —
// not a generic "Le remboursement a été refusé" placeholder.
//
// The map MUST stay exhaustive: TypeScript's `Record<RefundFailureReason,
// string>` type checks the keys, but the contract is stricter — every
// new reason added to the union MUST land in this map BEFORE the
// shared interface ships, or the operator falls back to the
// `provider_error` copy and loses the disambiguation we just paid
// for upstream.
import type { RefundFailureReason } from "@/providers/payment-provider.interface";

const REFUND_FAILURE_MESSAGES: Record<RefundFailureReason, string> = {
  manual_refund_required:
    "Ce fournisseur de paiement ne prend pas en charge les remboursements automatiques. " +
    "Contactez votre point de vente Orange Money ou effectuez le remboursement manuel " +
    "depuis le portail marchand. Marquez ensuite l'inscription comme annulée.",
  insufficient_funds:
    "Le remboursement a échoué : solde marchand insuffisant. " +
    "Vérifiez votre portefeuille Wave / Orange Money et réessayez après réapprovisionnement.",
  already_refunded:
    "Le fournisseur indique que ce paiement a déjà été remboursé. " +
    "Vérifiez le portail marchand et réconciliez l'inscription manuellement si nécessaire.",
  transaction_not_found:
    "Le fournisseur ne retrouve pas la transaction d'origine. " +
    "Contactez le support technique — le remboursement automatique n'est pas possible.",
  network_timeout:
    "Le fournisseur n'a pas répondu à temps. Réessayez dans quelques instants ; " +
    "si le problème persiste, contactez le support.",
  provider_error:
    "Le remboursement a été refusé par le fournisseur. " +
    "Consultez le tableau de bord d'incidents pour plus de détails.",
};

// ─── PaymentClientView projection (P1-09 / P1-12) ──────────────────────────
//
// Strips two provider-internal fields from any `Payment` before it crosses
// a public surface:
//
//   - `providerMetadata` — raw provider response (OM `notif_token`,
//     customer phone numbers, internal correlation IDs, …).
//   - `callbackUrl` — internal webhook URL that reveals our infra
//     topology and lets a malicious caller bypass our rate-limit by
//     posting directly to the URL.
//
// Every public service method that returns payment data MUST funnel
// through this helper. The only path allowed to expose the raw shape
// is the super-admin platform listing, which renders the metadata
// behind a redaction helper.
//
// Snapshot-test enforced: `payment.service.test.ts` →
// "PaymentClientView projection — no provider internals leak".
export function toPaymentClientView(payment: Payment): PaymentClientView {
  const {
    providerMetadata: _providerMetadata,
    callbackUrl: _callbackUrl,
    ...rest
  } = payment;
  return rest as PaymentClientView;
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
    opts: { idempotencyKey?: string } = {},
  ): Promise<{ paymentId: string; redirectUrl: string }> {
    this.requirePermission(user, "payment:initiate");

    // ── Read event (needed to derive organizationId for the plan gate) ──
    const event = await eventRepository.findByIdOrThrow(eventId);

    // ── P1-13 (audit H1) — paidTickets plan-feature gate at payment init ──
    // Money-of-record enforcement at the payment layer. Event creation
    // already enforces this at event.service.ts; we re-enforce here so a
    // free / starter org that downgrades AFTER creating a paid event can
    // never collect real money via this code path.
    //
    // Audit follow-up: gate fires immediately after the event lookup
    // (the only doc read REQUIRED to derive `organizationId`) and
    // BEFORE any other state-derived branch — event-status check,
    // ticket validation, capacity guard. A free/starter org never
    // exercises ticket business logic for a paid ticket, even on
    // events the operator created before downgrading. The earlier
    // shape ran the event-status + ticket-validation branches
    // first; the fix preserves the spec ("BEFORE any other state
    // change").
    const org = await organizationRepository.findByIdOrThrow(event.organizationId);
    this.requirePlanFeature(org, "paidTickets");

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

    // ── Prepare references ──
    const now = new Date().toISOString();
    const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc();
    const payRef = db.collection(COLLECTIONS.PAYMENTS).doc();
    const regId = regRef.id;
    const payId = payRef.id;
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

    // Resolve the provider HERE (not later) so the callback URL we
    // hand to the provider matches the route that ITS verifyWebhook
    // will run on. The webhook URL discriminator is the SOURCE
    // provider (who POSTs the IPN), not the user-picked method:
    //   - method="wave" + PAYDUNYA_ENABLED → provider.name="paydunya"
    //     → callback URL must be /v1/payments/webhook/paydunya so
    //     the PayDunya verifyWebhook runs on the inbound IPN.
    //   - method="wave" + LEGACY_PROVIDER → provider.name="wave"
    //     → callback URL is /v1/payments/webhook/wave (Wave's HMAC
    //     verifier runs).
    // Phase-2 follow-up: the previous shape used `method` directly,
    // which sent PayDunya the URL `/webhook/wave`. PayDunya's IPN
    // landed there, our wave verifier rejected it (signature scheme
    // mismatch), and the webhook event row was never recorded — the
    // payment stayed in `processing` indefinitely.
    const provider = getProvider(method);
    const callbackUrl = paymentWebhookUrl(provider.name);
    const defaultReturnUrl = paymentReturnUrl(eventId, payId);
    const finalReturnUrl = returnUrl ? assertAllowedReturnUrl(returnUrl) : defaultReturnUrl;

    // ── P1-06 (audit C1) — Idempotency key resolution ──
    // Client SHOULD pass an `Idempotency-Key` header (UUID per intent).
    // If absent, we synthesise a deterministic fingerprint covering
    // (userId, eventId, ticketTypeId, method) with a 60 s time bucket
    // — gives near-immediate retry coverage for legacy clients without
    // creating long-tail dedupe (after 60 s the user clicking buy
    // again is a deliberate new intent).
    const idemKeySource =
      opts.idempotencyKey?.trim() ||
      `synth:${user.uid}:${eventId}:${ticketTypeId}:${method}:${Math.floor(Date.now() / 60_000)}`;
    const idemDocId = crypto.createHash("sha256").update(idemKeySource).digest("hex").slice(0, 32);
    const idemRef = db.collection(COLLECTIONS.PAYMENT_IDEMPOTENCY_KEYS).doc(idemDocId);

    // ── P1-07 (audit H2) — Two-phase pattern, Phase 1 ──
    // tx1: idempotency check + duplicate-reg check + placeholder
    //      Payment + placeholder Registration. Provider session does
    //      NOT yet exist; we have a local record to attach it to.
    // After tx1 commits → outside-tx provider.initiate() call.
    // tx2: update placeholder Payment with the real
    //      providerTransactionId + redirectUrl.
    type Phase1 =
      | { kind: "replayed"; paymentId: string; redirectUrl: string }
      | { kind: "fresh"; payment: Payment };
    const phase1: Phase1 = await db.runTransaction(async (tx) => {
      // Idempotency: same key within 24h returns the cached payment.
      const existingIdem = await tx.get(idemRef);
      if (existingIdem.exists) {
        const cached = existingIdem.data() as {
          paymentId: string;
          redirectUrl?: string;
        };
        // Read the cached Payment to surface its current redirectUrl
        // (Phase 2 may have populated it after the idempotency doc
        // was first written).
        const cachedPayRef = db.collection(COLLECTIONS.PAYMENTS).doc(cached.paymentId);
        const cachedPaySnap = await tx.get(cachedPayRef);
        if (cachedPaySnap.exists) {
          const cachedPay = cachedPaySnap.data() as Payment;
          return {
            kind: "replayed",
            paymentId: cached.paymentId,
            redirectUrl: cachedPay.redirectUrl ?? cached.redirectUrl ?? "",
          };
        }
        // Idempotency claim exists but the Payment doesn't — orphaned
        // claim from a prior crash. Fall through to the fresh branch
        // and OVERWRITE the claim below (`tx.set(idemRef, ...)`
        // overwrites by default). Operator-perceived behaviour: the
        // retry succeeds, no duplicate created.
      }

      // Re-check for duplicate inside the transaction to prevent race
      // conditions (a different IK on the same user + event = a
      // genuinely new attempt that needs the dup guard).
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
        // Phase B-1 — denormalize the linked Payment id so the
        // participant web app can trigger "Resume payment" without
        // a separate query. Immutable post-creation; safe to
        // denormalize.
        paymentId: payId,
        createdAt: now,
        updatedAt: now,
      };

      // Placeholder payment: providerTransactionId + redirectUrl
      // populated in Phase 2. status='pending' (not 'processing')
      // until the provider session is confirmed.
      const placeholder: Payment = {
        id: payId,
        registrationId: regId,
        eventId,
        organizationId: event.organizationId,
        userId: user.uid,
        amount: ticketType.price,
        currency: "XOF",
        method,
        providerTransactionId: null,
        status: "pending",
        redirectUrl: null,
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
      tx.set(payRef, placeholder);
      // Idempotency claim: write AFTER reg + payment so the cached
      // `paymentId` always points to a doc that exists.
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      tx.set(idemRef, {
        paymentId: payId,
        userId: user.uid,
        eventId,
        ticketTypeId,
        method,
        createdAt: now,
        expiresAt,
        // Stored so a future audit / forensics surface can see whether
        // this was a client-supplied IK or a server-synthesised one.
        keySource: opts.idempotencyKey ? "client" : "synthetic",
      });

      return { kind: "fresh", payment: placeholder };
    });

    if (phase1.kind === "replayed") {
      return { paymentId: phase1.paymentId, redirectUrl: phase1.redirectUrl };
    }

    // ── Provider call (outside any tx — long network call) ──
    // `provider` was resolved above (before callback URL construction).
    // Re-using the same instance here so the registry lookup is done
    // exactly once per initiate call.
    let providerResult: { providerTransactionId: string; redirectUrl: string };
    try {
      providerResult = await provider.initiate({
        paymentId: payId,
        amount: ticketType.price,
        currency: "XOF",
        description: `Inscription : ${event.title} — ${ticketType.name}`,
        callbackUrl,
        returnUrl: finalReturnUrl,
        method,
      });
    } catch (err) {
      // P1-07 recovery — mark the placeholder Payment as `failed` so
      // the org dashboard surfaces a clear "provider rejected" state
      // rather than an orphan `pending` record. The reconciliation
      // job (Phase 3) double-checks any `pending` records older than
      // 5 min via `provider.verify()`.
      //
      // Phase-1 audit follow-up: ONLY `ProviderError` is allowed to
      // surface its message into `Payment.failureReason` — that
      // message is the sanitised French copy from `app-error.ts`
      // (e.g. "Le fournisseur de paiement « wave » a répondu avec
      // une erreur (502)"). Raw Node.js network errors
      // (`connect ECONNREFUSED 10.0.0.1:443`, `fetch failed`,
      // `AbortError`) MUST NOT reach the wire because:
      //   1. failureReason ends up on `getPaymentStatus` and
      //      `listEventPayments` responses (it's NOT in the
      //      PaymentClientView omit set).
      //   2. The raw message can leak our infra IPs, internal
      //      hostnames, or DNS topology to the participant /
      //      organizer dashboard.
      // The sanitised fallback covers timeouts and DNS failures
      // with operator-actionable French copy. The full underlying
      // error stays on stderr via `provider-error-logger` (P1-11).
      const failureReason =
        err instanceof ProviderError
          ? err.message.slice(0, 500)
          : "Erreur réseau lors de la connexion au fournisseur — réessayez dans quelques instants";
      await db
        .collection(COLLECTIONS.PAYMENTS)
        .doc(payId)
        .update({
          status: "failed" satisfies PaymentStatus,
          failureReason,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {
          // Update best-effort; the placeholder will be picked up by
          // the reconciliation sweep if this update fails.
        });
      throw err;
    }

    // ── P1-07 Phase 2: update placeholder with real provider data ──
    await db.runTransaction(async (tx) => {
      const update: Partial<Payment> = {
        providerTransactionId: providerResult.providerTransactionId,
        status: "processing" satisfies PaymentStatus,
        redirectUrl: providerResult.redirectUrl,
        updatedAt: new Date().toISOString(),
      };
      tx.update(payRef, update);
      // Refresh idempotency cache with the redirectUrl so a retry
      // within the 24 h window returns the right URL even if it
      // arrives between Phase 1 and Phase 2.
      tx.update(idemRef, { redirectUrl: providerResult.redirectUrl });
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

    return { paymentId: payId, redirectUrl: providerResult.redirectUrl };
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

    // ── Anti-tampering invariants (Phase 2 / threat T-PD-03 / T-PD-04) ──
    //
    // A valid signature on a PayDunya IPN proves the request CAME FROM
    // PayDunya — it does NOT bind the payload to any specific Payment.
    // A malicious actor who briefly intercepted any valid PayDunya
    // webhook could re-emit it after mutating the amount or substituting
    // a different invoice token. These cross-checks turn the IPN into
    // a strongly-bound message:
    //
    //   1. providerTransactionId match — guaranteed by the lookup
    //      above; if `payment` is non-null, this invariant holds.
    //   2. metadata.expectedPaymentId === payment.id — the IPN's
    //      `custom_data.payment_id` is the value WE sent at initiate
    //      time. If the payload claims it's for a different Payment,
    //      something tampered.
    //   3. metadata.expectedAmount === payment.amount — same idea
    //      for the invoice total.
    //
    // For PayDunya specifically (metadata.providerName === "paydunya")
    // both fields are REQUIRED. A missing field is treated as an
    // attack vector — an attacker who controls the IPN body could
    // strip `invoice.total_amount` to bypass the amount cross-check.
    // Phase-2 security review P-1 closed this gap.
    //
    // For Wave / OM / mock the fields are SKIPPED (those providers
    // don't carry expectedPaymentId / expectedAmount on their
    // payload). The provider-name discriminator decides which
    // contract applies.
    //
    // On mismatch / missing field we throw `ValidationError` — the
    // route handler returns 400 to the provider, the webhook log row
    // is marked `failed`, and a `payment.tampering_attempted` event
    // fires for the audit listener (Phase-2 follow-up).
    const isPayDunya = metadata?.providerName === "paydunya";
    const expectedPaymentId = metadata?.expectedPaymentId;
    const expectedAmount = metadata?.expectedAmount;

    /**
     * Internal helper — fires the tampering audit event AND throws
     * the user-facing ValidationError. Centralised so every reject
     * branch leaves the same paper trail in `auditLogs`. Receives
     * the field discriminator + observed/expected values; truncates
     * the received value to a bounded length so a hostile payload
     * can't bloat the audit row.
     */
    const flagTampering = (
      field: "payment_id" | "amount",
      received: string | number | null,
      expected: string | number,
      message: string,
    ): never => {
      const receivedSafe =
        typeof received === "string" ? received.slice(0, 200) : received;
      eventBus.emit("payment.tampering_attempted", {
        paymentId: payment.id,
        organizationId: payment.organizationId,
        field,
        expectedValue: expected,
        receivedValue: receivedSafe,
        providerName: typeof metadata?.providerName === "string" ? metadata.providerName : "unknown",
        actorId: "system:webhook",
        requestId: getRequestId() ?? "system:webhook",
        timestamp: new Date().toISOString(),
      });
      throw new ValidationError(message, {
        reason: "payload_tampering",
        field,
        expected,
      });
    };

    if (isPayDunya) {
      if (typeof expectedPaymentId !== "string") {
        flagTampering(
          "payment_id",
          expectedPaymentId === undefined ? null : (expectedPaymentId as string | number | null),
          payment.id,
          "Webhook payload tampering detected: missing payment_id",
        );
      }
      if (typeof expectedAmount !== "number") {
        flagTampering(
          "amount",
          expectedAmount === undefined ? null : (expectedAmount as string | number | null),
          payment.amount,
          "Webhook payload tampering detected: missing amount",
        );
      }
    }

    if (typeof expectedPaymentId === "string" && expectedPaymentId !== payment.id) {
      flagTampering(
        "payment_id",
        expectedPaymentId,
        payment.id,
        "Webhook payload tampering detected: payment_id mismatch",
      );
    }
    if (typeof expectedAmount === "number" && expectedAmount !== payment.amount) {
      flagTampering(
        "amount",
        expectedAmount,
        payment.amount,
        "Webhook payload tampering detected: amount mismatch",
      );
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
      // ── P1-08 (audit H3) — wasNewlySucceeded flag ──────────────────
      // Concurrent webhook retries from Wave / OM (2-5 deliveries
      // within seconds) used to fire `payment.succeeded` once per
      // invocation that reached the emit, even when the inner-tx
      // idempotency guard correctly prevented the LEDGER from being
      // double-written. That double-emitted notifications, audit
      // rows, and `registration.confirmed` cascades.
      //
      // Capture the actual-transition signal from inside the
      // transaction; emit only when the tx truly flipped status.
      let wasNewlySucceeded = false;
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

        wasNewlySucceeded = true;

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

      // P1-08 — fire only on the actual `processing → succeeded`
      // transition (suppressed on no-op retries that hit the inner-tx
      // idempotency guard). Without this gate, listeners would be
      // notified multiple times per single payment.
      if (wasNewlySucceeded) {
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
      }
    } else {
      // ── Payment failed — atomic update of payment + registration ──
      // P1-08 — same wasNewlyFailed gate as the success path so a
      // duplicate `failed` webhook doesn't double-fire the failure
      // notification cascade.
      let wasNewlyFailed = false;
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

        wasNewlyFailed = true;

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

      if (!wasNewlyFailed) return;
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
   *
   * Returns a projected `PaymentClientView` (no `providerMetadata`,
   * no `callbackUrl`) — the raw `Payment` shape is reserved for the
   * super-admin platform-management surface, which has its own
   * redaction helper. P1-09 (audit C3).
   *
   * P1-14 (audit cross-org IDOR) — `requireOrganizationAccess` runs
   * for EVERY non-owner caller, including system-admin roles whose
   * roles claim might list multiple orgs. The previous shape only
   * gated `payment:read_all` callers, leaving an org-A admin with a
   * payment:read_all + cross-org event scope able to read org-B
   * payments. The new flow:
   *
   *   1. owner short-circuit (`payment.userId === user.uid`)
   *   2. super-admin short-circuit (`platform:manage` implies all)
   *   3. otherwise: require `payment:read_all` AND
   *      `requireOrganizationAccess(payment.organizationId)`.
   */
  async getPaymentStatus(paymentId: string, user: AuthUser): Promise<PaymentClientView> {
    this.requirePermission(user, "payment:read_own");
    const payment = await paymentRepository.findByIdOrThrow(paymentId);
    const isOwner = payment.userId === user.uid;
    const isSuperAdmin = user.roles.some(isAdminSystemRole);
    if (!isOwner && !isSuperAdmin) {
      this.requirePermission(user, "payment:read_all");
      this.requireOrganizationAccess(user, payment.organizationId);
    }
    return toPaymentClientView(payment);
  }

  /**
   * Phase B-2 — Resume a payment that's stuck in `processing` (user
   * came back from PayDunya without completing, then re-clicks
   * "Compléter mon paiement"). Returns the existing redirectUrl so
   * the user can finish the same checkout session.
   *
   * Behaviour matrix:
   *   - status=processing AND redirectUrl set       → return it
   *   - status=processing AND redirectUrl missing   → 422 (placeholder
   *     stuck — operator action required)
   *   - status=succeeded                            → 409 (already paid)
   *   - status=failed/refunded/expired              → 422 (cancel +
   *     re-register from scratch via cancelPending)
   *   - status=pending (Phase-1 placeholder)        → 422 (initiate
   *     phase 2 didn't complete; cancel + retry)
   *
   * Permission: `payment:initiate` (same as the original initiate)
   * + owner-only (other people don't get to inspect a payment's
   * checkout URL even if they have payment:read_all).
   *
   * Idempotent: re-calling within the PayDunya invoice TTL (24 h
   * per provider) returns the same redirectUrl. After that, the
   * upstream session may have expired — the handler doesn't
   * re-validate the URL with the provider here (would slow the
   * happy path); the participant's browser sees a PayDunya error
   * if the session is gone, and they can fall back to cancel +
   * re-register.
   */
  async resumePayment(
    paymentId: string,
    user: AuthUser,
  ): Promise<{ paymentId: string; redirectUrl: string; status: PaymentStatus }> {
    this.requirePermission(user, "payment:initiate");
    const payment = await paymentRepository.findByIdOrThrow(paymentId);

    // Owner-only — other users (even with payment:read_all) don't get
    // to fetch a checkout URL that's tied to someone else's flow.
    if (payment.userId !== user.uid) {
      throw new ForbiddenError(
        "Vous ne pouvez reprendre que vos propres paiements en cours",
      );
    }

    if (payment.status === "succeeded") {
      throw new ConflictError("Ce paiement est déjà confirmé", {
        reason: "already_succeeded",
      });
    }

    if (
      payment.status === "failed" ||
      payment.status === "refunded" ||
      payment.status === "expired"
    ) {
      throw new ValidationError(
        "Ce paiement ne peut plus être repris — annulez l'inscription en attente et réessayez.",
        { reason: "terminal_status", status: payment.status },
      );
    }

    if (payment.status === "pending") {
      // The Phase-1 P1-07 placeholder never completed tx2 of initiate
      // (provider call didn't return). The redirectUrl is null — we
      // can't resume blindly. The user must cancel + re-register.
      throw new ValidationError(
        "Ce paiement n'a pas pu être démarré chez le fournisseur. Annulez l'inscription en attente et réessayez.",
        { reason: "initiate_incomplete" },
      );
    }

    // status === "processing"
    if (!payment.redirectUrl) {
      throw new ValidationError(
        "Ce paiement n'a pas d'URL de redirection valide. Annulez l'inscription en attente et réessayez.",
        { reason: "missing_redirect_url" },
      );
    }

    return {
      paymentId: payment.id,
      redirectUrl: payment.redirectUrl,
      status: payment.status,
    };
  }

  /**
   * ADR-0018 — Verify-on-return: finalise a payment by reading the
   * official state from the provider, used as a robust fallback when
   * the provider's IPN delivery is unreliable (notably PayDunya
   * sandbox).
   *
   * Flow when the participant lands on /payment-status after redirect-
   * back from the provider hosted checkout:
   *
   *   1. Authorize — owner-only (the user who initiated the payment).
   *   2. Idempotency short-circuit — if the Payment is already
   *      terminal (succeeded / failed / refunded / expired), return
   *      the current state. The IPN may have raced ahead and
   *      finalised the Payment already.
   *   3. Resolve provider — derive from the stored payment.method.
   *      For PayDunya routing, getProvider(method) returns
   *      paydunyaPaymentProvider (provider.name === "paydunya"); for
   *      legacy direct-Wave/OM, it returns the matching provider.
   *   4. Call provider.verify(providerTransactionId) — the provider
   *      hits its own confirm-invoice API and returns the official
   *      state (succeeded / failed / pending). The response is
   *      authoritative because we made the call (no payload-tampering
   *      vector — see ADR-0018 §threat model).
   *   5. If terminal, run the SAME state-machine flip as the IPN
   *      success/failure path (Payment update + Registration confirm
   *      + Event counter increment + ledger entries + payment.succeeded
   *      / payment.failed emit). Idempotency-safe — the inner-tx
   *      re-read prevents double-application even if the IPN lands
   *      milliseconds later.
   *   6. Emit `payment.verified_from_redirect` for audit traceability
   *      so operators can distinguish IPN-finalised vs. verify-
   *      finalised when investigating provider-IPN reliability.
   *
   * No provider call is made if the Payment is already terminal
   * (step 2). This is critical: a chatty front-end could repeatedly
   * call /verify on a /payment-status remount, and we don't want to
   * pay an outbound API call per remount.
   *
   * Permission: `payment:read_own` (the verify path is a read of the
   * provider's official state — no NEW state is requested, we only
   * synchronise our local mirror with what the provider already
   * decided).
   */
  async verifyAndFinalize(
    paymentId: string,
    user: AuthUser,
  ): Promise<{ paymentId: string; status: PaymentStatus; outcome: "succeeded" | "failed" | "pending" }> {
    this.requirePermission(user, "payment:read_own");

    const payment = await paymentRepository.findByIdOrThrow(paymentId);

    // Owner-only — even payment:read_all admins don't get to trigger a
    // verify on someone else's payment, because the call has the side
    // effect of flipping our local mirror. State-mutation rights are
    // narrower than read rights.
    if (payment.userId !== user.uid) {
      throw new ForbiddenError(
        "Vous ne pouvez vérifier que vos propres paiements",
      );
    }

    // Idempotency — already-terminal payments need no provider call.
    // This guard is essential: the front-end may call /verify on every
    // remount of /payment-status, and we don't want to bombard the
    // provider with redundant confirm-invoice calls.
    if (
      payment.status === "succeeded" ||
      payment.status === "failed" ||
      payment.status === "refunded" ||
      payment.status === "expired"
    ) {
      return {
        paymentId: payment.id,
        status: payment.status,
        outcome:
          payment.status === "succeeded"
            ? "succeeded"
            : payment.status === "failed" || payment.status === "expired"
              ? "failed"
              : "succeeded", // refunded => was succeeded
      };
    }

    if (!payment.providerTransactionId) {
      // The two-phase initiate (P1-07) didn't reach tx2 — there's no
      // provider session to verify against. The cron timeout will
      // sweep this row to expired in due course; the user sees a
      // clean error instead of a 500.
      throw new ValidationError(
        "Ce paiement n'a pas encore de session fournisseur active. Annulez et réessayez.",
        { reason: "no_provider_transaction" },
      );
    }

    const provider = getProvider(payment.method);

    // Provider verify — synchronous server-to-server call. PayDunya
    // hits /checkout-invoice/confirm/<token>; Wave hits the equivalent
    // session endpoint. Whatever they return is authoritative.
    const verifyResult = await provider.verify(payment.providerTransactionId);

    const requestId = getRequestId();
    const now = new Date().toISOString();
    const audit = (outcome: "succeeded" | "failed" | "pending") => {
      eventBus.emit("payment.verified_from_redirect", {
        paymentId: payment.id,
        registrationId: payment.registrationId,
        eventId: payment.eventId,
        organizationId: payment.organizationId,
        outcome,
        providerName: provider.name,
        actorId: user.uid,
        requestId,
        timestamp: now,
      });
    };

    if (verifyResult.status === "pending") {
      // Provider hasn't finalised on its side either — leave our
      // Payment in `processing` and tell the caller to keep polling.
      // Audit-log the inconclusive verify so operators investigating
      // a stuck-payment incident can see the verify path was tried.
      audit("pending");
      return { paymentId: payment.id, status: payment.status, outcome: "pending" };
    }

    // ── Terminal: run the same state-machine flip as the IPN path ──
    // The transaction logic mirrors handleWebhook's success / failure
    // branches BYTE-FOR-BYTE on the parts that matter (idempotency
    // guard, registration flip, event counter, ledger entries). The
    // ONLY differences:
    //   - no anti-tampering checks (we made the verify call ourselves,
    //     no attacker-controllable payload to validate)
    //   - the metadata blob carries a `source: "verify_on_return"`
    //     marker so providerMetadata reads can distinguish the path
    //     in audit forensics
    //
    // Note: this is intentionally NOT factored into a shared private
    // helper with handleWebhook — the existing code is the most-
    // exercised financial path and stays untouched here. A follow-up
    // refactor can DRY both call sites once verify-on-return has
    // baked in production for a sprint.
    const enrichedMetadata = {
      ...(verifyResult.metadata ?? {}),
      source: "verify_on_return" as const,
      verifiedAt: now,
      providerName: provider.name,
    };

    if (verifyResult.status === "succeeded") {
      let wasNewlySucceeded = false;
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

        wasNewlySucceeded = true;

        const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(payment.registrationId);
        const regSnap = await tx.get(regRef);
        if (!regSnap.exists) {
          throw new NotFoundError("Registration", payment.registrationId);
        }

        const eventRef = db.collection(COLLECTIONS.EVENTS).doc(payment.eventId);
        const eventSnap = await tx.get(eventRef);
        const eventData = eventSnap.data() as Event | undefined;

        tx.update(payRef, {
          status: "succeeded" as PaymentStatus,
          completedAt: now,
          updatedAt: now,
          providerMetadata: enrichedMetadata,
        });

        tx.update(regRef, {
          status: "confirmed",
          updatedAt: now,
        });

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
          createdBy: "system:payment.verify",
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
            createdBy: "system:payment.verify",
            createdAt: now,
          });
        }
      });

      // Same wasNewlySucceeded gate as handleWebhook — the canonical
      // payment.succeeded event MUST fire only on the actual
      // processing → succeeded transition, never on a no-op (e.g.
      // an IPN that landed milliseconds before our verify call).
      if (wasNewlySucceeded) {
        eventBus.emit("payment.succeeded", {
          paymentId: payment.id,
          registrationId: payment.registrationId,
          eventId: payment.eventId,
          organizationId: payment.organizationId,
          amount: payment.amount,
          actorId: payment.userId,
          requestId,
          timestamp: now,
        });
      }

      audit("succeeded");
      return { paymentId: payment.id, status: "succeeded", outcome: "succeeded" };
    }

    // verifyResult.status === "failed"
    let wasNewlyFailed = false;
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

      wasNewlyFailed = true;

      const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(payment.registrationId);

      tx.update(payRef, {
        status: "failed" as PaymentStatus,
        failureReason:
          (verifyResult.metadata?.reason as string) ??
          "Paiement refusé par le fournisseur (vérification à retour de redirection)",
        updatedAt: now,
        providerMetadata: enrichedMetadata,
      });

      tx.update(regRef, {
        status: "cancelled",
        updatedAt: now,
      });
    });

    if (wasNewlyFailed) {
      eventBus.emit("payment.failed", {
        paymentId: payment.id,
        registrationId: payment.registrationId,
        eventId: payment.eventId,
        organizationId: payment.organizationId,
        actorId: payment.userId,
        requestId,
        timestamp: now,
      });
    }

    audit("failed");
    return { paymentId: payment.id, status: "failed", outcome: "failed" };
  }

  /**
   * Phase 3 — Reconciliation cron sweep.
   *
   * Scans Firestore for payments stuck in `processing` past the
   * configured "IPN should have arrived by now" threshold, calls
   * `provider.verify()` server-to-server for each one, and finalises
   * the Payment with the official provider state. The complementary
   * piece to verify-on-return: covers the case where the participant
   * closed the tab BEFORE landing on /payment-status, so the
   * client-driven verify never fires.
   *
   * State-machine relationship to onPaymentTimeout
   * ───────────────────────────────────────────────
   * The existing `onPaymentTimeout` cron sweeps EVERY payment past
   * the (default 30 min) TTL and flips it to `expired` regardless of
   * provider state. That's the safety net.
   *
   * Reconciliation runs INSIDE that window (default 5–25 min after
   * createdAt) — early enough to give the provider time to actually
   * succeed, late enough that a missed IPN is the likely explanation.
   * For each candidate it asks the provider what really happened:
   *   - succeeded → finalise as a confirmed Payment (same tx as IPN)
   *   - failed    → finalise as a failed Payment (same tx as IPN)
   *   - pending   → leave alone; either the next reconciliation tick
   *                 picks it up, or onPaymentTimeout expires it
   *
   * Authorization
   * ─────────────
   * System-mode only (no AuthUser). Method is `public` (not
   * `private`) so test files can exercise it directly without
   * routing through the internal endpoint, and so future internal
   * callers (e.g. an admin "Run reconciliation now" button on
   * /admin/audit) can call it cleanly. The trust boundary is at
   * the route layer — any HTTP surface that exposes this method
   * MUST gate on the shared-secret pattern documented in
   * `internal.routes.ts`. Adding new public methods that call this
   * one is a security decision: confirm with the platform team
   * before merging.
   *
   * Idempotency
   * ───────────
   * Inner-tx guard inside each `db.runTransaction(...)` makes a
   * concurrent IPN landing safe — whichever wins, the other becomes
   * a no-op. The reconciliation method itself is also safe to run
   * concurrently with the verify-on-return path: same guard, same
   * outcome.
   *
   * Bounding
   * ────────
   * - `batchSize` caps the number of payments processed per
   *   invocation; defaults to 50. Anything beyond is left for the
   *   next tick. Prevents one slow provider from blocking the
   *   entire cron timeout.
   * - Each provider call is awaited sequentially (not parallel) so
   *   a slow provider doesn't fan out into hundreds of concurrent
   *   outbound HTTP calls. With 50 payments × 2 s/call worst-case =
   *   100 s, well within Cloud Functions' 540 s timeout.
   *
   * Returns aggregate stats per outcome bucket so the operator can
   * size the IPN-reliability gap from the audit log over time.
   *
   * See ADR-0018 §"Follow-ups required" for the full design context.
   */
  async reconcileStuckPayments(opts: {
    /** Lower bound — payments newer than this are skipped (give the IPN a chance). Default 5 min. */
    windowMinMs?: number;
    /** Upper bound — payments older than this are left for onPaymentTimeout. Default 25 min. */
    windowMaxMs?: number;
    /** Max payments processed per invocation. Default 50. */
    batchSize?: number;
  } = {}): Promise<{
    scanned: number;
    finalizedSucceeded: number;
    finalizedFailed: number;
    stillPending: number;
    errored: number;
  }> {
    const windowMinMs = opts.windowMinMs ?? 5 * 60 * 1000;
    const windowMaxMs = opts.windowMaxMs ?? 25 * 60 * 1000;
    const batchSize = Math.min(opts.batchSize ?? 50, 200);

    const now = Date.now();
    const lowerBound = new Date(now - windowMaxMs).toISOString();
    const upperBound = new Date(now - windowMinMs).toISOString();

    // Window query: createdAt ∈ [now-windowMax, now-windowMin] AND
    // status = "processing". Single composite index is sufficient
    // (`status, createdAt` — already declared in firestore.indexes.json).
    const snap = await db
      .collection(COLLECTIONS.PAYMENTS)
      .where("status", "==", "processing")
      .where("createdAt", ">=", lowerBound)
      .where("createdAt", "<=", upperBound)
      .orderBy("createdAt", "asc")
      .limit(batchSize)
      .get();

    let finalizedSucceeded = 0;
    let finalizedFailed = 0;
    let stillPending = 0;
    let errored = 0;

    for (const doc of snap.docs) {
      const payment = { id: doc.id, ...doc.data() } as Payment;
      try {
        const result = await this.reconcileSinglePayment(payment);
        if (result.outcome === "succeeded") finalizedSucceeded += 1;
        else if (result.outcome === "failed") finalizedFailed += 1;
        else stillPending += 1;
      } catch (err) {
        // Per-payment failures must not abort the whole sweep — one
        // misbehaving provider response would block reconciliation
        // for everyone else. Log + continue. The aggregate event
        // emit at the end carries the `errored` count for ops
        // dashboards.
        errored += 1;
        process.stderr.write(
          `${JSON.stringify({
            level: "error",
            event: "payment.reconciliation.payment_error",
            paymentId: payment.id,
            err: err instanceof Error ? err.message : String(err),
            time: new Date().toISOString(),
          })}\n`,
        );
      }
    }

    // Aggregate audit emit — operators read this from /admin/audit
    // (action: payment.reconciliation_swept) to size the IPN-
    // reliability gap over time. Emitted regardless of stats so a
    // healthy zero-stuck-payments tick is also visible (proves the
    // cron is alive vs. silently failing).
    eventBus.emit("payment.reconciliation_swept", {
      scanned: snap.size,
      finalizedSucceeded,
      finalizedFailed,
      stillPending,
      errored,
      windowMinMs,
      windowMaxMs,
      actorId: "system:payment.reconciliation",
      requestId: getRequestId() ?? "system:payment.reconciliation",
      timestamp: new Date().toISOString(),
    });

    return {
      scanned: snap.size,
      finalizedSucceeded,
      finalizedFailed,
      stillPending,
      errored,
    };
  }

  /**
   * Internal helper — finalises a single stuck payment by asking the
   * provider for its official state and applying the same state-machine
   * flip the IPN webhook would have done. Mirrors the logic inside
   * `verifyAndFinalize` but with `actorId="system:payment.reconciliation"`
   * and no ownership check (system-mode).
   *
   * Tracked as a Phase-2 follow-up TODO (collapse with handleWebhook +
   * verifyAndFinalize into a single private helper) — kept duplicated
   * here on purpose to minimise regression risk on the most-exercised
   * financial path during the reconciliation roll-out.
   */
  private async reconcileSinglePayment(payment: Payment): Promise<{
    paymentId: string;
    outcome: "succeeded" | "failed" | "pending";
  }> {
    if (
      payment.status === "succeeded" ||
      payment.status === "failed" ||
      payment.status === "refunded" ||
      payment.status === "expired"
    ) {
      // Already terminal between query and processing — no-op.
      return { paymentId: payment.id, outcome: payment.status === "succeeded" ? "succeeded" : "failed" };
    }

    if (!payment.providerTransactionId) {
      // Two-phase initiate (P1-07) didn't reach tx2 — there's no
      // provider session to verify against. Leave for onPaymentTimeout.
      return { paymentId: payment.id, outcome: "pending" };
    }

    const provider = getProvider(payment.method);
    const verifyResult = await provider.verify(payment.providerTransactionId);

    const requestId = getRequestId();
    const now = new Date().toISOString();
    const audit = (outcome: "succeeded" | "failed" | "pending") => {
      eventBus.emit("payment.verified_from_redirect", {
        paymentId: payment.id,
        registrationId: payment.registrationId,
        eventId: payment.eventId,
        organizationId: payment.organizationId,
        outcome,
        providerName: provider.name,
        // System-mode reconciliation — actorId is the cron, not a user.
        actorId: "system:payment.reconciliation",
        requestId: requestId ?? "system:payment.reconciliation",
        timestamp: now,
      });
    };

    if (verifyResult.status === "pending") {
      audit("pending");
      return { paymentId: payment.id, outcome: "pending" };
    }

    const enrichedMetadata = {
      ...(verifyResult.metadata ?? {}),
      source: "reconciliation" as const,
      verifiedAt: now,
      providerName: provider.name,
    };

    if (verifyResult.status === "succeeded") {
      let wasNewlySucceeded = false;
      await db.runTransaction(async (tx) => {
        const payRef = db.collection(COLLECTIONS.PAYMENTS).doc(payment.id);
        const paySnap = await tx.get(payRef);
        if (!paySnap.exists) return;
        const freshPayment = paySnap.data() as Payment;

        // FAIL-2 fix (security review 2026-04-26) — `expired` MUST be in
        // the terminal-state set here. `onPaymentTimeout` runs every 5
        // min and can flip the payment to `expired` between the outer
        // window query and this transactional re-read; without the
        // guard the reconciliation tx would overwrite `expired` →
        // `succeeded` and emit a spurious `payment.succeeded` for an
        // already-released seat.
        if (
          freshPayment.status === "succeeded" ||
          freshPayment.status === "failed" ||
          freshPayment.status === "refunded" ||
          freshPayment.status === "expired"
        ) {
          return;
        }
        wasNewlySucceeded = true;

        const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(payment.registrationId);
        const regSnap = await tx.get(regRef);
        if (!regSnap.exists) {
          throw new NotFoundError("Registration", payment.registrationId);
        }

        const eventRef = db.collection(COLLECTIONS.EVENTS).doc(payment.eventId);
        const eventSnap = await tx.get(eventRef);
        const eventData = eventSnap.data() as Event | undefined;

        tx.update(payRef, {
          status: "succeeded" as PaymentStatus,
          completedAt: now,
          updatedAt: now,
          providerMetadata: enrichedMetadata,
        });
        tx.update(regRef, { status: "confirmed", updatedAt: now });

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
          createdBy: "system:payment.reconciliation",
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
            createdBy: "system:payment.reconciliation",
            createdAt: now,
          });
        }
      });

      if (wasNewlySucceeded) {
        eventBus.emit("payment.succeeded", {
          paymentId: payment.id,
          registrationId: payment.registrationId,
          eventId: payment.eventId,
          organizationId: payment.organizationId,
          amount: payment.amount,
          actorId: payment.userId,
          requestId,
          timestamp: now,
        });
      }

      audit("succeeded");
      return { paymentId: payment.id, outcome: "succeeded" };
    }

    // verifyResult.status === "failed"
    let wasNewlyFailed = false;
    await db.runTransaction(async (tx) => {
      const payRef = db.collection(COLLECTIONS.PAYMENTS).doc(payment.id);
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists) return;
      const freshPayment = paySnap.data() as Payment;
      // FAIL-2 fix (security review 2026-04-26) — `expired` in the
      // terminal-state set so onPaymentTimeout race between the
      // outer scan and this tx commit doesn't get clobbered.
      if (
        freshPayment.status === "succeeded" ||
        freshPayment.status === "failed" ||
        freshPayment.status === "refunded" ||
        freshPayment.status === "expired"
      ) {
        return;
      }
      wasNewlyFailed = true;

      const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(payment.registrationId);
      // FAIL-4 fix (security review 2026-04-26) — `verifyResult.metadata`
      // is `Record<string, unknown>`; the previous `as string` cast was
      // a type assertion with no runtime check. A future provider that
      // populates `metadata.reason` with raw API response text would
      // write un-sanitised content to Firestore, then render it
      // verbatim on /payment-status. Bound to a safe printable string
      // truncated to 120 chars; fall back to the localized default.
      const rawReason = verifyResult.metadata?.reason;
      const safeReason =
        typeof rawReason === "string" && rawReason.length > 0 && rawReason.length <= 120
          ? rawReason
          : "Paiement refusé par le fournisseur (réconciliation)";
      tx.update(payRef, {
        status: "failed" as PaymentStatus,
        failureReason: safeReason,
        updatedAt: now,
        providerMetadata: enrichedMetadata,
      });
      tx.update(regRef, { status: "cancelled", updatedAt: now });
    });

    if (wasNewlyFailed) {
      eventBus.emit("payment.failed", {
        paymentId: payment.id,
        registrationId: payment.registrationId,
        eventId: payment.eventId,
        organizationId: payment.organizationId,
        actorId: payment.userId,
        requestId,
        timestamp: now,
      });
    }

    audit("failed");
    return { paymentId: payment.id, outcome: "failed" };
  }

  /**
   * List payments for an event (organizer view).
   *
   * Returns projected `PaymentClientView[]` so the org-admin dashboard
   * never has to know about `providerMetadata` / `callbackUrl`. The
   * pagination meta is forwarded unchanged. P1-09.
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
    const result = await paymentRepository.findByEvent(eventId, filters, pagination);
    return {
      data: result.data.map(toPaymentClientView),
      meta: result.meta,
    };
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
    let result: RefundResult;
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

      // P1-19 (audit M7) — surface a disambiguated, operator-actionable
      // message per reason. Falls back to the generic placeholder for
      // un-tagged failures (which is now an alarm condition: per the
      // RefundFailureReason invariant, every provider refund failure
      // MUST tag the reason). The `details.reason` payload mirrors the
      // discriminated union so the backoffice UI can render targeted
      // copy + a "retry" affordance for `network_timeout`.
      throw new ValidationError(
        REFUND_FAILURE_MESSAGES[result.reason ?? "provider_error"],
        {
          reason: result.reason ?? "provider_error",
          providerCode: result.providerCode,
        },
      );
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
    // P1-17 (audit M4) — capture audit attribution fields from inside
    // the transaction so the `payment.refunded` / `refund.issued`
    // emits draw from `freshPayment`, not the stale outer snapshot.
    // The fields (registrationId / eventId / organizationId) are
    // immutable on payments in practice, so this is defence-in-depth
    // — but it standardises the "audit-row-from-tx-state" pattern
    // already followed by `handleWebhook` and `appendLedgerEntry`.
    let isFullRefund = false;
    let auditAttribution: {
      registrationId: string;
      eventId: string;
      organizationId: string;
      userId: string;
    } | null = null;
    await db.runTransaction(async (tx) => {
      const payRef = db.collection(COLLECTIONS.PAYMENTS).doc(paymentId);
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists) throw new NotFoundError("Payment", paymentId);
      const freshPayment = paySnap.data() as Payment;
      auditAttribution = {
        registrationId: freshPayment.registrationId,
        eventId: freshPayment.eventId,
        organizationId: freshPayment.organizationId,
        userId: freshPayment.userId,
      };

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

    // P1-17 (audit M4) — `auditAttribution` is captured inside the tx
    // above so the audit / notification events draw from the
    // transactional re-read instead of the stale outer snapshot.
    // The non-null assertion is safe: the tx either commits and
    // populates `auditAttribution` or throws, in which case we never
    // reach this code path.
    /* istanbul ignore next */
    if (!auditAttribution) {
      throw new Error("auditAttribution missing — tx state was not captured");
    }
    const attribution = auditAttribution as {
      registrationId: string;
      eventId: string;
      organizationId: string;
      userId: string;
    };

    // Generic audit / state-transition event — fires on every successful
    // refund regardless of template routing. Kept so audit consumers,
    // accounting exports, and the admin-facing timeline don't have to
    // track the new refund-specific events.
    eventBus.emit("payment.refunded", {
      paymentId,
      registrationId: attribution.registrationId,
      eventId: attribution.eventId,
      organizationId: attribution.organizationId,
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
      registrationId: attribution.registrationId,
      eventId: attribution.eventId,
      organizationId: attribution.organizationId,
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
