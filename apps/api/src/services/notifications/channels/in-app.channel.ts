import {
  type ChannelAdapter,
  type ChannelCapabilities,
  type ChannelDispatchParams,
  type ChannelDispatchResult,
  type NotificationDefinition,
  type NotificationLocale,
  type NotificationType,
} from "@teranga/shared-types";
import { getRequestId } from "@/context/request-context";
import { registerChannelAdapter } from "../channel-registry";

// ─── In-app channel adapter (Phase D.1) ────────────────────────────────────
//
// Replaces the Phase 2.6 stub. When the NotificationDispatcher fans out to
// the `in_app` channel this adapter:
//
//   1. Resolves the Firestore `notifications/{id}` doc shape from the
//      catalog definition + templateParams + recipient.preferredLocale.
//   2. Writes the doc via `notificationService.writeInAppDoc()` so the
//      adapter stays decoupled from firebase-admin.
//   3. Multicasts FCM to the recipient's tokens via
//      `notificationService.sendFcmToUser()`.
//
// Test-mode semantics: test sends still write the Firestore doc (that's the
// whole point of the admin preview — the organiser wants to see the bell
// panel rendering). The doc is tagged with `data.isTestSend="true"` so
// support can triage, and the dispatcher already emits
// `notification.test_sent` instead of `notification.sent` so stats stay
// accurate.
//
// Idempotency: the dispatcher's `findRecentByIdempotencyKey` guard already
// short-circuits duplicate dispatches before we are invoked. The adapter
// intentionally performs no extra dedup — that would double-gate.

// ─── Capabilities ──────────────────────────────────────────────────────────

const IN_APP_CAPABILITIES: ChannelCapabilities = {
  attachments: false,
  richText: true,
  maxBodyLength: 0, // no hard cap on in-app body
  supportedLocales: [], // empty = every catalog locale (fr / en / wo)
};

// ─── Catalog-key → NotificationType mapping ────────────────────────────────
//
// The `notifications/{id}` doc schema (packages/shared-types/src/messaging.
// types.ts) carries a `NotificationType` enum that predates the catalog.
// The bell-panel UI + mobile app filter and group by this enum, so the
// adapter must translate the catalog key back into one of the enum values.
//
// Entries missing from this map fall back to `"system"` — that's the catch-
// all the UI already renders neutrally. Adding a proper catalog entry to
// the map is safe at any time.
const KEY_TO_NOTIFICATION_TYPE: Record<string, NotificationType> = {
  "registration.created": "registration_confirmed",
  "registration.approved": "registration_approved",
  "registration.cancelled": "registration_confirmed",
  "badge.ready": "badge_ready",
  "event.cancelled": "event_cancelled",
  "event.reminder": "event_reminder",
  "event.rescheduled": "event_updated",
  "event.feedback_requested": "event_updated",
  "payment.succeeded": "payment_success",
  "waitlist.promoted": "waitlist_promoted",
};

function deriveNotificationType(key: string): NotificationType {
  return KEY_TO_NOTIFICATION_TYPE[key] ?? "system";
}

// ─── i18n resolution ───────────────────────────────────────────────────────
//
// The catalog carries `displayName` + `description` as I18nString objects
// (fr / en / wo required). We prefer a future `titleByChannel.in_app` field
// once one lands; until then we fall back to displayName (title) and
// description (body). The v1 in-app experience matches the bell panel's
// existing layout: short title + 1-2 line supporting body.
//
// Legacy callers that invoke notificationService.send() with an explicit
// title/body pass them through via templateParams.title / templateParams.
// body — those take precedence over the catalog copy so the user-facing
// text stays identical to the pre-Phase-D.1 legacy path.

function resolveTitle(
  definition: NotificationDefinition,
  templateParams: Record<string, unknown>,
  locale: NotificationLocale,
): string {
  const override = typeof templateParams["title"] === "string"
    ? (templateParams["title"] as string).trim()
    : "";
  if (override.length > 0) return override;
  return definition.displayName[locale] ?? definition.displayName.fr;
}

function resolveBody(
  definition: NotificationDefinition,
  templateParams: Record<string, unknown>,
  locale: NotificationLocale,
): string {
  const override = typeof templateParams["body"] === "string"
    ? (templateParams["body"] as string).trim()
    : "";
  if (override.length > 0) return override;
  return definition.description[locale] ?? definition.description.fr;
}

function resolveLocale(value: unknown): NotificationLocale {
  return value === "en" || value === "wo" ? value : "fr";
}

function resolveData(
  templateParams: Record<string, unknown>,
): Record<string, string> | undefined {
  // Bell-panel deep-link data must be a flat map of strings. We copy
  // through any plain-string entries (eventId, registrationId, etc.) and
  // drop non-string fields — they belong to the email template, not the
  // in-app doc. Matches the pre-Phase-D.1 legacy shape.
  const explicit = templateParams["data"];
  if (explicit && typeof explicit === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(explicit as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
      else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

function resolveImageURL(templateParams: Record<string, unknown>): string | null {
  // Only https:// URLs are written to the notifications/{id} doc and
  // forwarded to FCM. Dropping javascript: / data: / file: at the source
  // means any downstream renderer (bell panel, mobile app, FCM push
  // image) can trust the stored value without a second round of
  // validation. templateParams arrives from server-trusted listeners
  // today, but the admin test-send endpoint (Phase 2.4) accepts
  // caller-controlled `sampleParams` which funnel here — hence the
  // belt-and-suspenders check.
  const raw = templateParams["imageURL"];
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

// ─── Adapter ───────────────────────────────────────────────────────────────

class InAppChannelAdapter implements ChannelAdapter {
  readonly channel = "in_app" as const;
  readonly capabilities = IN_APP_CAPABILITIES;

  supports(definition: NotificationDefinition): boolean {
    return definition.supportedChannels.includes("in_app");
  }

  async send(params: ChannelDispatchParams): Promise<ChannelDispatchResult> {
    const { definition, recipient, templateParams, testMode } = params;

    // In-app delivery requires a userId — a `notifications/{id}` doc is
    // user-scoped and FCM tokens are keyed on uid. Email-only recipients
    // (e.g. invitee flows before the account exists) are correctly
    // suppressed here with a no_recipient reason.
    if (!recipient.userId) {
      return { ok: false, suppressed: "no_recipient" };
    }

    const locale = resolveLocale(recipient.preferredLocale);
    const title = resolveTitle(definition, templateParams, locale);
    const body = resolveBody(definition, templateParams, locale);
    const data = resolveData(templateParams);
    const imageURL = resolveImageURL(templateParams);
    const type = deriveNotificationType(definition.key);

    try {
      // Lazy import to dodge the boot cycle: notification.service → here →
      // notification.service. Node's module cache dedups the call.
      const { notificationService } = await import("../../notification.service");

      const docId = await notificationService.writeInAppDoc({
        userId: recipient.userId,
        type,
        title,
        body,
        data,
        imageURL,
        ...(testMode ? { isTestSend: true } : {}),
      });

      // FCM push is fire-and-forget per the legacy contract — a token
      // misfire must not sink the in-app doc write.
      await notificationService.sendFcmToUser(recipient.userId, {
        title,
        body,
        data,
        imageURL,
      });

      return { ok: true, providerMessageId: docId };
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "error",
          event: "in_app_channel.send_error",
          requestId: getRequestId(),
          key: definition.key,
          userId: recipient.userId,
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
      return { ok: false, suppressed: "bounced" };
    }
  }
}

export const inAppChannelAdapter: ChannelAdapter = new InAppChannelAdapter();

// Register in the forward-looking registry on import. Safe to call more
// than once — registerChannelAdapter overwrites by design (test isolation).
registerChannelAdapter(inAppChannelAdapter);
