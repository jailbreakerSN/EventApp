import crypto from "node:crypto";
import {
  NOTIFICATION_CATALOG_BY_KEY,
  type DispatchRequest,
  type NotificationChannel,
  type NotificationDefinition,
  type NotificationRecipient,
  type NotificationSuppressionReason,
} from "@teranga/shared-types";
import { config } from "@/config/index";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import { notificationSettingsRepository } from "@/repositories/notification-settings.repository";
import { notificationDispatchLogRepository } from "@/repositories/notification-dispatch-log.repository";

// ─── Notification Dispatcher Service ───────────────────────────────────────
// Single entry point for every branded notification the platform sends.
// Replaces the ad-hoc emailService.sendXxx() fan-out (which become thin
// shims that call dispatch() behind the NOTIFICATIONS_DISPATCHER_ENABLED
// feature flag). Flow:
//
//   1. Look up the definition by key (loud stderr log if unknown — the
//      catalog's boot-time integrity check should have caught it).
//   2. Merge in the admin override from notificationSettings/{key}.
//      enabled=false → emit notification.suppressed(admin_disabled), return.
//   3. For each recipient:
//      a. user_opted_out check (skipped when userOptOutAllowed === false).
//      b. Hand off to the channel adapter — in v1 only `email` is live
//         (delegates to the emailService-registered adapter so the legacy
//         Resend code path stays unchanged). Other channels emit a
//         suppressed(no_recipient) audit event today and become real
//         adapters in Phase 6.
//      c. On success, emit notification.sent. On failure, emit suppressed.
//
// Fire-and-forget — every catch is swallowed and routed to the audit
// trail. Matches the existing emailService.sendToUser contract so
// callers (services, listeners) never see an exception.
//
// Named `notification-dispatcher.service.ts` (not `notification.service.ts`)
// because the latter already exists and powers FCM + in-app notifications.
// The two live side-by-side until Phase 6 folds FCM into a ChannelAdapter.
//
// Design refs:
//   - docs/notification-system-architecture.md §7 (dispatcher algorithm)
//   - docs/notification-system-roadmap.md Phase 1

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DispatchContext {
  /** Who asked for the send — defaults to the request ALS actor or "system". */
  actorId?: string;
  /** Override requestId when dispatch is called outside an HTTP request. */
  requestId?: string;
}

/**
 * Email channel abstraction — the dispatcher stays agnostic of the
 * react-email templates + Resend provider stack. `emailService.ts`
 * registers itself as the default adapter at module load (see that file).
 * Tests can swap in a mock with `setEmailChannelAdapter()`.
 */
export interface EmailChannelAdapter {
  send(params: EmailChannelDispatchParams): Promise<EmailChannelDispatchResult>;
}

export interface EmailChannelDispatchParams {
  definition: NotificationDefinition;
  recipient: NotificationRecipient;
  templateParams: Record<string, unknown>;
  idempotencyKey: string;
}

export interface EmailChannelDispatchResult {
  /** Whether the provider accepted the send. */
  ok: boolean;
  /** Provider id returned on success — landed in the audit trail. */
  messageId?: string;
  /** Machine-readable suppression reason when ok=false. */
  suppressed?: NotificationSuppressionReason;
}

// ─── Adapter registry ──────────────────────────────────────────────────────
// Single global registry. Swappable at test time via setEmailChannelAdapter().
// Populated by apps/api/src/services/email.service.ts on first import so
// dispatcher + emailService stay decoupled.

const adapters: {
  email?: EmailChannelAdapter;
} = {};

export function setEmailChannelAdapter(adapter: EmailChannelAdapter | undefined): void {
  adapters.email = adapter;
}

export function getEmailChannelAdapter(): EmailChannelAdapter | undefined {
  return adapters.email;
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

export class NotificationDispatcherService {
  /**
   * Dispatch a notification by catalog key. Fire-and-forget — the method
   * resolves once every recipient has been processed (successfully or
   * suppressed); it never throws.
   */
  async dispatch<P extends Record<string, unknown>>(
    req: DispatchRequest<P>,
    ctx?: DispatchContext,
  ): Promise<void> {
    try {
      const definition = NOTIFICATION_CATALOG_BY_KEY[req.key];
      if (!definition) {
        this.logServerError(req.key, "unknown notification key");
        return;
      }

      const baseEvent = this.buildBaseEvent(ctx);

      const override = await notificationSettingsRepository.findByKey(req.key);

      if (override && override.enabled === false) {
        this.emitSuppressed(req.key, "batch", "admin_disabled", baseEvent);
        return;
      }

      const effectiveChannels = this.resolveChannels(
        definition,
        override?.channels,
        req.channelOverride,
      );

      if (effectiveChannels.length === 0) {
        this.emitSuppressed(req.key, "batch", "admin_disabled", baseEvent);
        return;
      }

      if (req.recipients.length === 0) {
        this.emitSuppressed(req.key, "none", "no_recipient", baseEvent);
        return;
      }

      await Promise.all(
        req.recipients.map((recipient) =>
          this.dispatchToRecipient(definition, recipient, req, effectiveChannels, baseEvent),
        ),
      );
    } catch (err) {
      this.logServerError(req.key, err instanceof Error ? err.message : String(err));
    }
  }

  // ─── Per-recipient ──────────────────────────────────────────────────────

  private async dispatchToRecipient<P extends Record<string, unknown>>(
    definition: NotificationDefinition,
    recipient: NotificationRecipient,
    req: DispatchRequest<P>,
    channels: NotificationChannel[],
    baseEvent: { actorId: string; requestId: string; timestamp: string },
  ): Promise<void> {
    const recipientRef = this.recipientRef(recipient);

    // User opt-out — only applies when the definition allows it.
    if (definition.userOptOutAllowed && recipient.userId) {
      const optedOut = await this.isUserOptedOut(recipient.userId, definition.key);
      if (optedOut) {
        this.emitSuppressed(definition.key, recipientRef, "user_opted_out", baseEvent);
        return;
      }
    }

    for (const channel of channels) {
      await this.dispatchOnChannel(definition, channel, recipient, req, recipientRef, baseEvent);
    }
  }

  private async dispatchOnChannel<P extends Record<string, unknown>>(
    definition: NotificationDefinition,
    channel: NotificationChannel,
    recipient: NotificationRecipient,
    req: DispatchRequest<P>,
    recipientRef: string,
    baseEvent: { actorId: string; requestId: string; timestamp: string },
  ): Promise<void> {
    if (channel !== "email") {
      // Phase 1: only email is live. Record the intent so admins see in
      // the audit trail that an SMS / push / in_app send was configured
      // but not delivered — helps surface misconfigurations early.
      this.emitSuppressed(definition.key, recipientRef, "no_recipient", baseEvent, channel);
      return;
    }

    // The email adapter needs EITHER a userId (it looks up the user doc
    // for address + preferredLanguage) OR an explicit email address (for
    // invitee / newsletter-confirm flows where the caller never has a uid).
    if (!recipient.userId && !recipient.email) {
      this.emitSuppressed(definition.key, recipientRef, "no_recipient", baseEvent, "email");
      return;
    }

    const adapter = adapters.email;
    if (!adapter) {
      // Adapter not registered = configuration bug, not a send failure.
      // Emit no audit event (would double-log on retries); stderr only.
      this.logServerError(definition.key, "email channel adapter not registered");
      return;
    }

    const idempotencyKey = this.resolveIdempotencyKey(definition.key, recipient, req);

    try {
      const result = await adapter.send({
        definition,
        recipient,
        templateParams: req.params,
        idempotencyKey,
      });

      if (result.ok) {
        this.emitSent(definition.key, "email", recipientRef, result.messageId, baseEvent);
      } else {
        this.emitSuppressed(
          definition.key,
          recipientRef,
          result.suppressed ?? "bounced",
          baseEvent,
          "email",
        );
      }
    } catch (err) {
      this.logServerError(definition.key, err instanceof Error ? err.message : String(err));
      this.emitSuppressed(definition.key, recipientRef, "bounced", baseEvent, "email");
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * User per-key opt-out check. Reads notificationPreferences.byKey[key]
   * from the user's notification-preferences doc via the existing
   * emailService.getPreferences() read path. Absent / true → allowed;
   * explicit false → opted out.
   *
   * Fails open (returns false = not opted out) on Firestore error so a
   * transient read failure doesn't silently drop mail — better to deliver
   * one extra email than silently eat a transactional send.
   */
  private async isUserOptedOut(userId: string, key: string): Promise<boolean> {
    try {
      // Lazy import to avoid a boot cycle: emailService → dispatcher →
      // emailService (registers adapter).
      const mod = await import("./email.service");
      const prefs = (await mod.emailService.getPreferences(userId)) as unknown as Record<
        string,
        unknown
      >;
      const byKey = prefs["byKey"];
      if (byKey && typeof byKey === "object") {
        const value = (byKey as Record<string, unknown>)[key];
        if (value === false) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private resolveChannels(
    definition: NotificationDefinition,
    overrideChannels: NotificationChannel[] | undefined,
    requestOverride: NotificationChannel[] | undefined,
  ): NotificationChannel[] {
    const source = requestOverride ?? overrideChannels ?? definition.defaultChannels;
    // Admin can never enable a channel the catalog doesn't advertise as
    // supported — the rules defend the collection, but belt-and-suspenders
    // here protects callers that bypass the admin API (seed scripts).
    return source.filter((c) => definition.supportedChannels.includes(c));
  }

  /**
   * Build the idempotency key passed to the provider. The dispatcher
   * sandwiches the notification key + recipient id so two different
   * notifications to the same recipient never collide, and the same
   * notification to two recipients doesn't dedup across them.
   */
  private resolveIdempotencyKey<P extends Record<string, unknown>>(
    key: string,
    recipient: NotificationRecipient,
    req: DispatchRequest<P>,
  ): string {
    const recipientId = recipient.userId ?? recipient.email ?? "anonymous";
    const suffix = req.idempotencyKey ?? this.hashParams(req.params);
    return `${key}:${recipientId}:${suffix}`;
  }

  private hashParams(params: unknown): string {
    try {
      return crypto
        .createHash("sha256")
        .update(JSON.stringify(params ?? {}))
        .digest("hex")
        .slice(0, 16);
    } catch {
      return "noparams";
    }
  }

  private recipientRef(recipient: NotificationRecipient): string {
    if (recipient.userId) return `user:${recipient.userId}`;
    if (recipient.email) {
      // Mirror the redaction scheme in email.service.ts so log consumers
      // can join across dispatcher + suppressed-skip logs.
      const lower = recipient.email.toLowerCase();
      const [, domain = "?"] = lower.split("@");
      const hash = crypto.createHash("sha256").update(lower).digest("hex").slice(0, 8);
      return `email:${hash}@${domain}`;
    }
    return "anonymous";
  }

  private buildBaseEvent(ctx?: DispatchContext): {
    actorId: string;
    requestId: string;
    timestamp: string;
  } {
    const requestCtx = safeGetRequestContext();
    return {
      actorId: ctx?.actorId ?? requestCtx?.userId ?? "system",
      requestId: ctx?.requestId ?? requestCtx?.requestId ?? "dispatcher",
      timestamp: new Date().toISOString(),
    };
  }

  private emitSent(
    key: string,
    channel: NotificationChannel,
    recipientRef: string,
    messageId: string | undefined,
    baseEvent: { actorId: string; requestId: string; timestamp: string },
  ): void {
    eventBus.emit("notification.sent", {
      ...baseEvent,
      key,
      channel,
      recipientRef,
      ...(messageId ? { messageId } : {}),
    });
    // Phase 5 observability — append to the dispatch log for the
    // admin dashboard and bounce-rate alerts. Fire-and-forget so a
    // Firestore hiccup can't block the request.
    void notificationDispatchLogRepository.append({
      key,
      channel,
      recipientRef,
      status: "sent",
      ...(messageId ? { messageId } : {}),
      attemptedAt: baseEvent.timestamp,
      requestId: baseEvent.requestId,
      actorId: baseEvent.actorId,
    });
  }

  private emitSuppressed(
    key: string,
    recipientRef: string,
    reason: NotificationSuppressionReason,
    baseEvent: { actorId: string; requestId: string; timestamp: string },
    channel?: NotificationChannel,
  ): void {
    eventBus.emit("notification.suppressed", {
      ...baseEvent,
      key,
      recipientRef,
      reason,
      ...(channel ? { channel } : {}),
    });
    // Phase 5 observability — same log pipeline as `sent`. `reason`
    // lets the admin UI aggregate suppression by cause (admin_disabled
    // / user_opted_out / on_suppression_list / bounced / no_recipient).
    void notificationDispatchLogRepository.append({
      key,
      channel: channel ?? "email",
      recipientRef,
      status: "suppressed",
      reason,
      attemptedAt: baseEvent.timestamp,
      requestId: baseEvent.requestId,
      actorId: baseEvent.actorId,
    });
  }

  private logServerError(key: string, message: string): void {
    try {
      process.stderr.write(
        JSON.stringify({
          level: "error",
          event: "notification.dispatch_error",
          key,
          message,
        }) + "\n",
      );
    } catch {
      // never throw from the fire-and-forget path
    }
  }
}

export const notificationDispatcher = new NotificationDispatcherService();

/**
 * Rollout flag. Call sites (e.g. emailService.sendXxx) branch on this to
 * decide whether to route through the dispatcher or the legacy code path.
 * Exposed as a function so tests can mutate `config` before the read.
 */
export function isDispatcherEnabled(): boolean {
  return config.NOTIFICATIONS_DISPATCHER_ENABLED === true;
}

function safeGetRequestContext(): { userId?: string; requestId?: string } | null {
  try {
    const ctx = getRequestContext();
    if (!ctx) return null;
    return { userId: ctx.userId, requestId: ctx.requestId };
  } catch {
    return null;
  }
}
