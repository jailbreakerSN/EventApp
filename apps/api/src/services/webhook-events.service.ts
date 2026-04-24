import { BaseService } from "./base.service";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { AppError, NotFoundError, ForbiddenError } from "@/errors/app-error";
import { rateLimit } from "./rate-limit.service";
import { paymentService } from "./payment.service";
import {
  webhookEventsRepository,
  webhookEventDocId,
} from "@/repositories/webhook-events.repository";
import {
  ERROR_CODES,
  type AdminWebhookEventsQuery,
  type WebhookEventLog,
  type WebhookProvider,
} from "@teranga/shared-types";
import type { PaginatedResult } from "@/repositories/base.repository";

/**
 * T2.1 — Webhook events log + replay service.
 *
 * See `packages/shared-types/src/webhook-events.types.ts` for the full
 * architectural rationale. Three responsibilities:
 *
 *   - **record()** — called by the payment webhook route after
 *     signature verification but BEFORE the handler runs. Idempotent
 *     upsert on the (provider, tx, status) triple.
 *   - **markOutcome()** — called after the handler returns (or
 *     throws). Updates the row with the processing outcome + attempt
 *     metadata so operators see the full timeline.
 *   - **replay()** — admin-surfaced. Reads the stored row, re-invokes
 *     `paymentService.handleWebhook` with the stored parsed payload,
 *     updates the log. Idempotent: the payment handler already guards
 *     against double-processing, so replaying a "processed" row is
 *     safe (the attempts counter ticks but no side effect lands).
 *
 * Replay is synchronous within the admin POST — fast-pathed by the
 * payment handler's own idempotency check, so the response usually
 * lands in < 200 ms even on a "processed" replay.
 */

// Matches the rate-limit patterns used by impersonation + jobs: 10
// replays / min / admin is generous for legitimate ops workflows
// (click through a list of failed events) and bounds operator error.
const REPLAY_RATE_LIMIT = { limit: 10, windowSec: 60 };

// Receipt-time headers we actually want to keep. Everything else is
// dropped so we never persist auth tokens, cookies, or request ids
// that belong to other systems. Provider signatures + content-type
// are sufficient for future signature re-verification.
const HEADER_ALLOWLIST = new Set<string>([
  "content-type",
  "content-length",
  "user-agent",
  "x-wave-signature",
  "x-orange-money-signature",
  "x-free-money-signature",
  "x-webhook-signature",
  "x-request-id",
]);

function filterHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    if (!HEADER_ALLOWLIST.has(lower)) continue;
    if (value == null) continue;
    out[lower] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export interface RecordParams {
  provider: WebhookProvider;
  providerTransactionId: string;
  providerStatus: "succeeded" | "failed";
  eventType: string | null;
  rawBody: string;
  rawHeaders: Record<string, string | string[] | undefined>;
  metadata: Record<string, unknown> | null;
}

export interface MarkOutcomeParams {
  id: string;
  processingStatus: "processed" | "failed";
  lastError?: { code: string; message: string } | null;
  /** When known post-processing — filled in by the payment handler's callback. */
  paymentId?: string | null;
  organizationId?: string | null;
}

class WebhookEventsService extends BaseService {
  // ─── Receipt ──────────────────────────────────────────────────────────────

  /**
   * Persist a received webhook BEFORE invoking the handler. Idempotent
   * on the composite doc id — a retry from the provider with the same
   * payload is a no-op except for the `attempts` counter increment.
   */
  async record(params: RecordParams): Promise<string> {
    const id = webhookEventDocId(
      params.provider,
      params.providerTransactionId,
      params.providerStatus,
    );
    const nowIso = new Date().toISOString();

    const existing = await webhookEventsRepository.findById(id);

    if (existing) {
      // Retry — don't overwrite immutable fields (firstReceivedAt,
      // rawBody). Bump attempt metadata so the timeline shows the
      // provider re-sent us the same event.
      await webhookEventsRepository.update(id, {
        attempts: existing.attempts + 1,
        lastAttemptedAt: nowIso,
        requestId: getRequestId(),
      });
      return id;
    }

    // Retention: 90 days from first receipt. Long enough for ops
    // replay workflows (most deliveries are debugged within days of
    // the incident), short enough that storage stays bounded. Stored
    // as ISO for audit + the Firestore TTL policy picks up the same
    // field — see infrastructure/firebase/firestore.ttl.md.
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const expiresAtIso = new Date(Date.now() + ninetyDaysMs).toISOString();

    const event: WebhookEventLog = {
      id,
      provider: params.provider,
      providerTransactionId: params.providerTransactionId,
      providerStatus: params.providerStatus,
      eventType: params.eventType,
      // Defensive cap — Firestore doc max is 1 MiB but webhook bodies
      // really shouldn't be > 64 KB. Truncate visibly so ops know.
      rawBody:
        params.rawBody.length <= 64 * 1024
          ? params.rawBody
          : params.rawBody.slice(0, 64 * 1024) +
            `… [truncated, original length ${params.rawBody.length}]`,
      rawHeaders: filterHeaders(params.rawHeaders),
      metadata: params.metadata,
      processingStatus: "received",
      attempts: 1,
      paymentId: null,
      organizationId: null,
      firstReceivedAt: nowIso,
      lastAttemptedAt: nowIso,
      expiresAt: expiresAtIso,
      lastError: null,
      requestId: getRequestId(),
    };

    await webhookEventsRepository.upsert(event);
    return id;
  }

  async markOutcome(params: MarkOutcomeParams): Promise<void> {
    await webhookEventsRepository.update(params.id, {
      processingStatus: params.processingStatus,
      lastError: params.lastError ?? null,
      paymentId: params.paymentId ?? null,
      organizationId: params.organizationId ?? null,
      lastAttemptedAt: new Date().toISOString(),
    });
  }

  // ─── Admin — list / get ────────────────────────────────────────────────────

  async list(
    user: AuthUser,
    query: AdminWebhookEventsQuery,
  ): Promise<PaginatedResult<WebhookEventLog>> {
    this.requirePermission(user, "platform:manage");
    return webhookEventsRepository.list(query);
  }

  async get(user: AuthUser, id: string): Promise<WebhookEventLog> {
    this.requirePermission(user, "platform:manage");
    const event = await webhookEventsRepository.findById(id);
    if (!event) {
      throw new AppError({
        code: ERROR_CODES.WEBHOOK_EVENT_NOT_FOUND,
        message: `Webhook event « ${id} » introuvable.`,
        statusCode: 404,
      });
    }
    return event;
  }

  // ─── Admin — replay ────────────────────────────────────────────────────────

  /**
   * Re-invoke the payment handler with the stored payload. Idempotent
   * via `paymentService.handleWebhook`'s own payment-status guard.
   */
  async replay(
    user: AuthUser,
    id: string,
    actorDisplayName: string | null,
  ): Promise<WebhookEventLog> {
    this.requirePermission(user, "platform:manage");
    // Scope-narrow role check — every `platform:*` subrole holds
    // `platform:manage` today, but only super-admins + support should
    // replay webhooks in production. Keeping this loose matches the
    // job runner; tighten here when we split the role matrix.
    if (!user.roles.some((r) => r === "super_admin" || r.startsWith("platform:"))) {
      throw new ForbiddenError("Seuls les super-administrateurs peuvent rejouer un webhook.");
    }

    const rl = await rateLimit({
      scope: "admin.webhook_replay",
      identifier: user.uid,
      limit: REPLAY_RATE_LIMIT.limit,
      windowSec: REPLAY_RATE_LIMIT.windowSec,
    });
    if (!rl.allowed) {
      throw new ForbiddenError(
        `Quota de replay atteint (${REPLAY_RATE_LIMIT.limit}/min). Réessayez dans ${rl.retryAfterSec ?? 60}s.`,
      );
    }

    const event = await webhookEventsRepository.findById(id);
    if (!event) {
      throw new NotFoundError("Webhook event", id);
    }

    // Increment attempts BEFORE invoking the handler — the attempt
    // counter should reflect that we tried even if the handler throws
    // immediately. Rolling it back on exception would hide the failure.
    const attemptAt = new Date().toISOString();
    await webhookEventsRepository.update(id, {
      attempts: event.attempts + 1,
      lastAttemptedAt: attemptAt,
      requestId: getRequestId(),
    });

    // Emit the trigger event before the work so downstream listeners
    // (security alerting) see the replay attempt even if the handler
    // hangs or times out upstream.
    eventBus.emit("admin.webhook_replayed", {
      actorUid: user.uid,
      webhookEventId: id,
      provider: event.provider,
      providerTransactionId: event.providerTransactionId,
    });

    await db.collection(COLLECTIONS.AUDIT_LOGS).add({
      action: "admin.webhook_replayed",
      actorId: user.uid,
      actorRole:
        user.roles.find((r) => r === "super_admin" || r.startsWith("platform:")) ?? "super_admin",
      actorDisplayName,
      resourceType: "webhook_event",
      resourceId: id,
      organizationId: event.organizationId,
      details: {
        provider: event.provider,
        providerTransactionId: event.providerTransactionId,
        providerStatus: event.providerStatus,
        attempt: event.attempts + 1,
      },
      requestId: getRequestId(),
      timestamp: attemptAt,
    });

    try {
      // The payment handler is already idempotent via the
      // payment.status guard (handleWebhook fast-returns when the
      // payment is already terminal). So replaying a "processed" row
      // produces no double-side-effect — only the attempt counter
      // ticks. Matches the Stripe "Retry event" button semantics.
      await paymentService.handleWebhook(
        event.providerTransactionId,
        event.providerStatus,
        event.metadata ?? undefined,
      );
      await this.markOutcome({
        id,
        processingStatus: "processed",
        lastError: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code ?? "HANDLER_ERROR";
      await this.markOutcome({
        id,
        processingStatus: "failed",
        lastError: { code, message },
      });
      throw err;
    }

    // Re-read so the caller gets the terminal shape, not a hand-built
    // optimistic merge. One extra read but guarantees consistency.
    const final = await webhookEventsRepository.findById(id);
    if (!final) {
      // Shouldn't happen — we just wrote it.
      throw new AppError({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "Webhook event disappeared after replay",
        statusCode: 500,
      });
    }
    return final;
  }
}

export const webhookEventsService = new WebhookEventsService();
