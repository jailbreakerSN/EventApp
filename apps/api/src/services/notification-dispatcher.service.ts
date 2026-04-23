import crypto from "node:crypto";
import {
  NOTIFICATION_CATALOG_BY_KEY,
  type ChannelAdapter,
  type DispatchRequest,
  type NotificationCategory,
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
import {
  isChannelAllowedForUser,
  type NotificationPreferencesLike,
} from "./notifications/channel-preferences";
import { getChannelAdapter } from "./notifications/channel-registry";

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
  /**
   * Phase 2.4 — set when the dispatch originates from the admin
   * "test send" flow. The email adapter forwards this to the
   * suppression-list check (bypassed) and tags the outbound email
   * so support can triage preview-generated deliveries.
   */
  testMode?: boolean;
}

export interface EmailChannelDispatchResult {
  /** Whether the provider accepted the send. */
  ok: boolean;
  /** Provider id returned on success — landed in the audit trail. */
  messageId?: string;
  /** Machine-readable suppression reason when ok=false. */
  suppressed?: NotificationSuppressionReason;
}

// ─── Dedup window policy (Phase 2.2) ───────────────────────────────────────
// How far back the dispatcher looks in the dispatch log to catch a
// duplicate emit. Keyed by NotificationCategory — event reminders
// reasonably recur every few days (weekly series, "Save the date" +
// T-24h reminders) so the window must be shorter than the cadence.
// Marketing drips are tight (1h ≈ a fat-finger double-click).
// Transactional / auth / billing are terminal one-shots; 24h gives
// ample grace for pubsub redelivery + manual retries without blocking
// legitimate re-sends on day 2.
//
// The dispatcher derives the key from definition.category; unknown
// categories fall back to DEFAULT_DEDUP_WINDOW_MS via the map's nullish
// lookup below (category is always populated in the catalog, so this
// is defense in depth).
const DEDUP_WINDOW_MS: Record<NotificationCategory, number> = {
  auth: 24 * 60 * 60 * 1000, // 24h
  billing: 24 * 60 * 60 * 1000, // 24h
  transactional: 24 * 60 * 60 * 1000, // 24h
  organizational: 24 * 60 * 60 * 1000, // 24h
  marketing: 60 * 60 * 1000, // 1h
};
/** Fallback for catalog entries with an unknown/unmapped category. */
const DEFAULT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * event.reminder is the one outlier — reminders ship on a 7-day
 * cadence (Save the date / T-7d / T-1d), so a 24h window misses
 * nothing yet a 7d window catches accidental double-schedules from
 * the reminder cron. Keyed by catalog key so we don't punish every
 * `organizational` notification with the longer window.
 */
const DEDUP_WINDOW_MS_BY_KEY: Record<string, number> = {
  "event.reminder": 7 * 24 * 60 * 60 * 1000, // 7d
};

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

      // Phase 2.4 — testMode flows (admin "test send" from the
      // notifications control plane) bypass admin-disabled and
      // user-opt-out. A super-admin explicitly triggered the preview,
      // so we never want a prior admin toggle to hide the template.
      if (!req.testMode && override && override.enabled === false) {
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

    // Phase B.1 — load the caller's preferences ONCE per recipient so we
    // can honour per-channel opt-outs inside dispatchOnChannel. In test
    // mode (admin preview) we skip the lookup entirely; opt-out rules
    // never apply there. Mandatory notifications (`userOptOutAllowed =
    // false`) also skip the lookup — the dispatcher explicitly ignores
    // preferences for auth/billing and we don't want a Firestore read
    // per password-reset dispatch.
    const preferences: NotificationPreferencesLike | null =
      !req.testMode && definition.userOptOutAllowed && recipient.userId
        ? await this.loadUserPreferences(recipient.userId)
        : null;

    // Legacy-aggregate fast path — a user who set `byKey[key] = false`
    // (bare-boolean opt-out) blankets every channel. Emit a single
    // per-recipient suppression event rather than N per-channel ones so
    // the audit trail stays readable for pre-Phase-2.6 docs.
    if (preferences) {
      const entry = preferences.byKey?.[definition.key];
      if (entry === false) {
        this.emitSuppressed(definition.key, recipientRef, "user_opted_out", baseEvent);
        return;
      }
    }

    for (const channel of channels) {
      // Per-channel opt-out — Phase 2.6 per-channel object OR the no-op
      // "absent / true" case. Skips silently for mandatory keys
      // (`preferences` is null) so the check never blocks security mail.
      if (preferences && !isChannelAllowedForUser(preferences, definition.key, channel)) {
        this.emitSuppressed(
          definition.key,
          recipientRef,
          "user_opted_out",
          baseEvent,
          channel,
        );
        continue;
      }
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
    // Channel-specific preflight:
    //   - email retains the legacy EmailChannelAdapter contract (tagged
    //     via `adapters.email`) so the Resend/react-email stack is
    //     untouched by Phase D.1.
    //   - in_app (Phase D.1) and any future sms/push adapter resolve
    //     through the forward-looking ChannelAdapter registry.
    if (channel === "email") {
      // The email adapter needs EITHER a userId (it looks up the user doc
      // for address + preferredLanguage) OR an explicit email address (for
      // invitee / newsletter-confirm flows where the caller never has a uid).
      if (!recipient.userId && !recipient.email) {
        this.emitSuppressed(definition.key, recipientRef, "no_recipient", baseEvent, "email");
        return;
      }

      const emailAdapter = adapters.email;
      if (!emailAdapter) {
        // Adapter not registered = configuration bug, not a send failure.
        // Emit no audit event (would double-log on retries); stderr only.
        this.logServerError(definition.key, "email channel adapter not registered");
        return;
      }

      return this.dispatchOnEmailChannel(
        definition,
        recipient,
        req,
        recipientRef,
        emailAdapter,
        baseEvent,
      );
    }

    // Phase D.1 — in_app routes through the ChannelAdapter registry. Any
    // future sms/push adapter will take the same path for free once the
    // registry is populated.
    const registeredAdapter = getChannelAdapter(channel);
    if (!registeredAdapter) {
      // Adapter not wired yet (sms / push) OR the in-app adapter was not
      // registered at boot. Emit a suppression so admins can see the
      // misconfiguration in the dispatch log.
      this.emitSuppressed(definition.key, recipientRef, "no_recipient", baseEvent, channel);
      return;
    }

    return this.dispatchOnGenericChannel(
      definition,
      channel,
      recipient,
      req,
      recipientRef,
      registeredAdapter,
      baseEvent,
    );
  }

  // ─── Email-specific adapter path ───────────────────────────────────────
  // Lifted out of dispatchOnChannel so the non-email path (in_app today,
  // sms/push in Phase E) stays readable. The email path predates the
  // forward-looking ChannelAdapter contract and keeps its own typed
  // EmailChannelAdapter interface (messageId vs providerMessageId, etc.).

  private async dispatchOnEmailChannel<P extends Record<string, unknown>>(
    definition: NotificationDefinition,
    recipient: NotificationRecipient,
    req: DispatchRequest<P>,
    recipientRef: string,
    adapter: EmailChannelAdapter,
    baseEvent: { actorId: string; requestId: string; timestamp: string },
  ): Promise<void> {
    const idempotencyKey = this.resolveIdempotencyKey(definition.key, recipient, req);

    // Phase 2.2 — persistent idempotency check. The dispatch log is
    // queried before every adapter.send so a retried listener / pubsub
    // redelivery / buggy caller gets short-circuited BEFORE a provider
    // round-trip, and the event is recorded as "deduplicated" (not
    // "sent") so admin stats stay accurate. Resend's own idempotency
    // would catch the dup too, but only after the HTTP round-trip and
    // without surfacing the retry to our observability stack.
    //
    // Window derives from the definition's category (see DEDUP_WINDOW_MS
    // above) with a per-key override for event.reminder's 7-day cadence.
    //
    // Phase 2.4 — testMode skips the dedup check. Every admin preview
    // is expected to be unique and must always round-trip to the
    // provider (otherwise "send again" after tweaking sample params
    // would be silently suppressed).
    if (!req.testMode) {
      const windowMs = DEDUP_WINDOW_MS_BY_KEY[definition.key] ??
        DEDUP_WINDOW_MS[definition.category] ??
        DEFAULT_DEDUP_WINDOW_MS;
      const prior = await notificationDispatchLogRepository.findRecentByIdempotencyKey(
        idempotencyKey,
        windowMs,
      );
      if (prior) {
        this.emitDeduplicated(
          definition.key,
          "email",
          recipientRef,
          idempotencyKey,
          prior.attemptedAt,
          baseEvent,
        );
        return;
      }
    }

    try {
      const result = await adapter.send({
        definition,
        recipient,
        templateParams: req.params,
        idempotencyKey,
        ...(req.testMode ? { testMode: true } : {}),
      });

      if (result.ok) {
        if (req.testMode) {
          // Phase 2.4 — test sends emit a distinct audit event and
          // NEVER append to the dispatch log so admin stats widgets
          // stay accurate (test sends are out-of-band previews, not
          // real traffic).
          this.emitTestSent(
            definition.key,
            "email",
            recipientRef,
            result.messageId,
            recipient.preferredLocale,
            baseEvent,
          );
        } else {
          this.emitSent(
            definition.key,
            "email",
            recipientRef,
            result.messageId,
            idempotencyKey,
            baseEvent,
          );
        }
      } else {
        this.emitSuppressed(
          definition.key,
          recipientRef,
          result.suppressed ?? "bounced",
          baseEvent,
          "email",
          idempotencyKey,
        );
      }
    } catch (err) {
      this.logServerError(definition.key, err instanceof Error ? err.message : String(err));
      this.emitSuppressed(
        definition.key,
        recipientRef,
        "bounced",
        baseEvent,
        "email",
        idempotencyKey,
      );
    }
  }

  // ─── Generic ChannelAdapter path (Phase D.1 and beyond) ────────────────
  // in_app today; sms + push once their adapters land. Mirrors the email
  // path — idempotency dedup, adapter.send, then `notification.sent` /
  // `notification.test_sent` / `notification.suppressed` + dispatch-log
  // row — but consumes the forward-looking `ChannelAdapter` contract
  // (providerMessageId instead of messageId, etc.).

  private async dispatchOnGenericChannel<P extends Record<string, unknown>>(
    definition: NotificationDefinition,
    channel: NotificationChannel,
    recipient: NotificationRecipient,
    req: DispatchRequest<P>,
    recipientRef: string,
    adapter: ChannelAdapter,
    baseEvent: { actorId: string; requestId: string; timestamp: string },
  ): Promise<void> {
    const idempotencyKey = this.resolveIdempotencyKey(definition.key, recipient, req);

    // Persistent idempotency — same policy as email (see dispatchOnEmailChannel
    // for the rationale). testMode deliberately skips the dedup check so
    // admin previews always reach the provider.
    if (!req.testMode) {
      const windowMs = DEDUP_WINDOW_MS_BY_KEY[definition.key] ??
        DEDUP_WINDOW_MS[definition.category] ??
        DEFAULT_DEDUP_WINDOW_MS;
      const prior = await notificationDispatchLogRepository.findRecentByIdempotencyKey(
        idempotencyKey,
        windowMs,
      );
      if (prior) {
        this.emitDeduplicated(
          definition.key,
          channel,
          recipientRef,
          idempotencyKey,
          prior.attemptedAt,
          baseEvent,
        );
        return;
      }
    }

    try {
      const result = await adapter.send({
        definition,
        recipient,
        templateParams: req.params,
        idempotencyKey,
        ...(req.testMode ? { testMode: true } : {}),
      });

      if (result.ok) {
        if (req.testMode) {
          this.emitTestSent(
            definition.key,
            channel,
            recipientRef,
            result.providerMessageId,
            recipient.preferredLocale,
            baseEvent,
          );
        } else {
          this.emitSent(
            definition.key,
            channel,
            recipientRef,
            result.providerMessageId,
            idempotencyKey,
            baseEvent,
          );
        }
      } else {
        this.emitSuppressed(
          definition.key,
          recipientRef,
          result.suppressed ?? "bounced",
          baseEvent,
          channel,
          idempotencyKey,
        );
      }
    } catch (err) {
      this.logServerError(definition.key, err instanceof Error ? err.message : String(err));
      this.emitSuppressed(
        definition.key,
        recipientRef,
        "bounced",
        baseEvent,
        channel,
        idempotencyKey,
      );
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Load the caller's notification-preferences doc for per-channel
   * resolution (Phase B.1 fold-in of Phase 2.6's isChannelAllowedForUser).
   * Reads via the existing emailService.getPreferences() path so docs
   * written before Phase 2.6 stay readable as `Record<string, boolean>`.
   *
   * Fails open (returns null = no opt-out known) on Firestore error so a
   * transient read failure doesn't silently drop mail — better to deliver
   * one extra email than silently eat a transactional send. A null return
   * intentionally also disables the in-loop channel check; legacy callers
   * whose prefs can't be read keep the pre-B.1 behavior.
   */
  private async loadUserPreferences(
    userId: string,
  ): Promise<NotificationPreferencesLike | null> {
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
        return { byKey: byKey as NotificationPreferencesLike["byKey"] };
      }
      return { byKey: {} };
    } catch {
      return null;
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
    idempotencyKey: string,
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
      idempotencyKey,
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
    idempotencyKey?: string,
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
    //
    // `idempotencyKey` is optional on this path because pre-adapter
    // short-circuits (empty recipients, admin_disabled with no per-
    // recipient context, unsupported channels) happen before it's
    // computed. When absent we persist a placeholder derived from the
    // key + recipientRef so the row still carries a stable dedup
    // identifier for audit queries.
    const effectiveIdempotencyKey =
      idempotencyKey ?? `${key}:${recipientRef}:pre-adapter`;
    void notificationDispatchLogRepository.append({
      key,
      channel: channel ?? "email",
      recipientRef,
      status: "suppressed",
      reason,
      idempotencyKey: effectiveIdempotencyKey,
      attemptedAt: baseEvent.timestamp,
      requestId: baseEvent.requestId,
      actorId: baseEvent.actorId,
    });
  }

  /**
   * Phase 2.2 — persistent-dedup emit path. Fires a
   * `notification.deduplicated` domain event AND appends a log row
   * with status="deduplicated" so the admin stats aggregation can
   * count retry storms separately from real sends. Intentionally
   * does NOT emit notification.sent — that would double-count the
   * send in downstream listeners (audit trail would show two
   * deliveries when only one ever reached the provider).
   */
  /**
   * Phase 2.4 — test-send emit path. Fires `notification.test_sent`
   * (distinct from `notification.sent`) and deliberately does NOT
   * append to the dispatch log. Rationale: admin previews must not
   * inflate delivery stats — an admin testing a template 20 times in
   * a row would otherwise skew the bounce rate and fill the suppression
   * histogram with noise.
   */
  private emitTestSent(
    key: string,
    channel: NotificationChannel,
    recipientRef: string,
    messageId: string | undefined,
    locale: "fr" | "en" | "wo",
    baseEvent: { actorId: string; requestId: string; timestamp: string },
  ): void {
    eventBus.emit("notification.test_sent", {
      ...baseEvent,
      key,
      channel,
      recipientRef,
      locale,
      ...(messageId ? { messageId } : {}),
    });
  }

  private emitDeduplicated(
    key: string,
    channel: NotificationChannel,
    recipientRef: string,
    idempotencyKey: string,
    originalAttemptedAt: string,
    baseEvent: { actorId: string; requestId: string; timestamp: string },
  ): void {
    eventBus.emit("notification.deduplicated", {
      ...baseEvent,
      key,
      channel,
      recipientRef,
      idempotencyKey,
      originalAttemptedAt,
    });
    void notificationDispatchLogRepository.append({
      key,
      channel,
      recipientRef,
      status: "deduplicated",
      idempotencyKey,
      deduplicated: true,
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
