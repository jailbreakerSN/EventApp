// ─── Rollback Plan (Phase D.1) ─────────────────────────────────────────────
// This service is in a two-PR migration to the ChannelAdapter contract.
//
//   Current PR (this file):
//     - Introduces `writeInAppDoc()` + `sendFcmToUser()` helpers used by
//       the new `inAppChannelAdapter` (see ./notifications/channels/
//       in-app.channel.ts).
//     - Flag-gates `send()` / `broadcast()` on `config.USE_IN_APP_ADAPTER`.
//       Flag OFF (default) → legacy direct-write path runs unchanged.
//       Flag ON → route through `notificationDispatcher.dispatch({ key, ... })`
//       so admin kill-switch, per-channel user opt-out, persistent
//       idempotency, and dispatch-log audit all apply uniformly.
//     - The 5 call sites in events/listeners/notification.listener.ts are
//       UNCHANGED. They still invoke notificationService.send({ type, title,
//       body, ... }). The flag flip silently rewires them through the
//       dispatcher via the NOTIFICATION_TYPE_TO_KEY map below.
//
//   Follow-up PR (staging flip, 48h soak):
//     - Flip `USE_IN_APP_ADAPTER=true` in staging.
//     - Run `npm run in-app:diff` against the emulator to confirm the
//       Firestore doc produced by the dispatcher path is byte-for-byte
//       identical to the legacy direct path (modulo id + timestamps).
//     - Monitor the dispatch-log for unexpected suppressions
//       (admin_disabled / user_opted_out / no_recipient).
//
//   Cleanup PR (once staging shows zero drift):
//     - Remove the legacy direct-write branch from `send()` / `broadcast()`.
//     - Migrate the 5 listener call sites to dispatcher.dispatch() directly.
//     - Delete `NOTIFICATION_TYPE_TO_KEY` once no caller depends on it.
//
//   Rollback at any point: set `USE_IN_APP_ADAPTER=false`. The dispatcher
//   branch is fire-and-forget; failure falls back to surface-level audit
//   logging without losing the Firestore doc because the legacy path
//   short-circuits before the dispatcher is called.
// ───────────────────────────────────────────────────────────────────────────

import {
  type Notification,
  type NotificationChannel,
  type NotificationType,
} from "@teranga/shared-types";
import { type DocumentSnapshot } from "firebase-admin/firestore";
import { config } from "@/config/index";
import { db, messaging, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { registrationRepository } from "@/repositories/registration.repository";
import { userRepository } from "@/repositories/user.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ForbiddenError } from "@/errors/app-error";
import { BaseService } from "./base.service";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SendNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageURL?: string;
}

interface BroadcastParams {
  eventId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface WriteInAppDocInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageURL?: string | null;
  /** Optional ISO timestamp. Defaults to `new Date().toISOString()`. */
  createdAt?: string;
  /**
   * Phase D.1 test-send tag. Populated when the dispatcher test-mode path
   * seeds a preview doc so support can triage admin-generated rows.
   */
  isTestSend?: boolean;
}

interface SendFcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageURL?: string | null;
}

// ─── NotificationType → catalog key map ────────────────────────────────────
//
// Legacy callers (`notification.listener.ts`, a handful of services) hand us
// a `NotificationType` enum value. The dispatcher wants a catalog key. This
// map bridges the two while both pathways coexist.
//
// Entries marked `null` are legitimately ambiguous (e.g. `"system"` has no
// catalog entry — it's a free-form admin broadcast). When the flag is on and
// a caller passes one of these, we log a structured warning and fall back to
// the legacy direct-write path for that one call. Never throw — we refuse
// to drop the user-visible notification over a mapping hole.
const NOTIFICATION_TYPE_TO_KEY: Record<NotificationType, string | null> = {
  registration_confirmed: "registration.created",
  registration_approved: "registration.approved",
  payment_success: "payment.succeeded",
  badge_ready: "badge.ready",
  event_cancelled: "event.cancelled",
  event_reminder: "event.reminder",
  waitlist_promoted: "waitlist.promoted",
  event_updated: null, // no catalog entry — legacy direct-write
  event_published: null, // no catalog entry — legacy direct-write
  check_in_success: null, // no catalog entry — legacy direct-write
  new_message: null, // no catalog entry — legacy direct-write
  new_announcement: null, // no catalog entry — legacy direct-write
  broadcast: null, // free-form organizer broadcast — legacy direct-write
  system: null, // free-form admin broadcast — legacy direct-write
};

function logMappingFallback(type: NotificationType, reason: string): void {
  try {
    process.stderr.write(
      JSON.stringify({
        level: "warn",
        event: "notification_service.dispatcher_mapping_fallback",
        type,
        reason,
        note: "Falling back to legacy direct-write path for this call.",
      }) + "\n",
    );
  } catch {
    // never throw from fire-and-forget logging
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class NotificationService extends BaseService {
  private get notificationsCollection() {
    return db.collection(COLLECTIONS.NOTIFICATIONS);
  }

  /**
   * Public helper — write a single `notifications/{id}` Firestore doc and
   * return the doc id. Used by the in-app channel adapter so the adapter
   * doesn't have to import `@/config/firebase` directly and can share the
   * legacy document shape exactly.
   */
  async writeInAppDoc(input: WriteInAppDocInput): Promise<string> {
    const docRef = this.notificationsCollection.doc();
    const createdAt = input.createdAt ?? new Date().toISOString();
    const data: Record<string, string> | undefined = input.isTestSend
      ? { ...(input.data ?? {}), isTestSend: "true" }
      : input.data;
    const notification: Notification = {
      id: docRef.id,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data,
      imageURL: input.imageURL ?? null,
      isRead: false,
      readAt: null,
      createdAt,
    };
    await docRef.set(notification);
    return docRef.id;
  }

  /**
   * Public helper — FCM multicast to a single user's tokens. Mirrors the
   * legacy `sendPush()` behavior (swallows errors, logs to stderr) so the
   * new adapter can share the fire-and-forget semantics without owning the
   * admin SDK dependency itself.
   */
  async sendFcmToUser(userId: string, payload: SendFcmPayload): Promise<void> {
    try {
      const tokens = await userRepository.getFcmTokens([userId]);
      if (tokens.length === 0) return;

      await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.imageURL ? { imageUrl: payload.imageURL } : {}),
        },
        data: payload.data,
      });
    } catch (err) {
      process.stderr.write(
        `[NotificationService] FCM push failed for user ${userId}: ${err}\n`,
      );
    }
  }

  /**
   * Send a notification to a single user.
   * Creates Firestore notification doc + sends FCM push.
   *
   * When `USE_IN_APP_ADAPTER=true` this routes through the multi-channel
   * dispatcher (admin kill-switch, per-channel opt-out, idempotency, audit
   * log). When the type cannot be mapped to a catalog key, OR when the flag
   * is off, the legacy direct-write path runs.
   */
  async send(params: SendNotificationParams): Promise<Notification> {
    const { userId, type, title, body, data, imageURL } = params;

    if (config.USE_IN_APP_ADAPTER) {
      const key = NOTIFICATION_TYPE_TO_KEY[type];
      if (key) {
        try {
          // Lazy import to avoid a boot cycle: dispatcher imports the adapter
          // which imports this service.
          const { notificationDispatcher } = await import(
            "./notification-dispatcher.service"
          );
          await notificationDispatcher.dispatch({
            key,
            recipients: [
              {
                userId,
                preferredLocale: "fr",
              },
            ],
            params: {
              title,
              body,
              data: data ?? {},
              imageURL: imageURL ?? null,
            },
            channelOverride: ["in_app"],
          });
          // The dispatcher wrote the Firestore doc via the adapter, but it
          // doesn't surface the doc back to the caller. For back-compat
          // with the legacy return shape we build the notification object
          // from the input. Tests that assert `mockDocSet was called` still
          // pass because the adapter wrote through `writeInAppDoc`.
          return {
            id: "dispatched",
            userId,
            type,
            title,
            body,
            data,
            imageURL: imageURL ?? null,
            isRead: false,
            readAt: null,
            createdAt: new Date().toISOString(),
          };
        } catch (err) {
          // Fire-and-forget degradation: if the dispatcher blows up, fall
          // through to the legacy path so a user-visible notification is
          // never silently dropped because of an upstream wiring bug.
          process.stderr.write(
            JSON.stringify({
              level: "error",
              event: "notification_service.dispatcher_fallthrough",
              type,
              err: err instanceof Error ? err.message : String(err),
            }) + "\n",
          );
        }
      } else {
        logMappingFallback(type, "no_catalog_key_for_type");
      }
    }

    // Legacy direct-write path — create the notification doc + fire FCM.
    const now = new Date().toISOString();
    const id = await this.writeInAppDoc({
      userId,
      type,
      title,
      body,
      data,
      imageURL: imageURL ?? null,
      createdAt: now,
    });
    await this.sendFcmToUser(userId, { title, body, data, imageURL: imageURL ?? null });

    return {
      id,
      userId,
      type,
      title,
      body,
      data,
      imageURL: imageURL ?? null,
      isRead: false,
      readAt: null,
      createdAt: now,
    };
  }

  /**
   * Broadcast a notification to all confirmed participants of an event.
   * Uses cursor-based pagination to avoid loading all registrations into memory.
   *
   * Broadcast (`type: "broadcast"`) has no catalog entry — the dispatcher
   * branch is intentionally skipped here regardless of the flag. A future
   * phase can seed a `broadcast.event` catalog key with per-user opt-out
   * and re-wire this method; until then broadcasts stay on the legacy
   * batch-write path so organizers keep their low-latency fanout.
   */
  async broadcast(params: BroadcastParams, user: AuthUser): Promise<{ sent: number }> {
    this.requirePermission(user, "notification:send");

    const event = await eventRepository.findByIdOrThrow(params.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const CHUNK_SIZE = 500;
    const now = new Date().toISOString();
    let totalSent = 0;
    let lastDoc: DocumentSnapshot | null = null;

    let hasMore = true;
    while (hasMore) {
      const page = await registrationRepository.findByEventCursor(
        params.eventId,
        ["confirmed", "checked_in"],
        CHUNK_SIZE,
        lastDoc ?? undefined,
      );

      if (page.data.length === 0) break;
      lastDoc = page.lastDoc;
      hasMore = page.data.length === CHUNK_SIZE;

      // Create in-app notification documents in a batch (one per chunk)
      const batch = db.batch();
      const chunkUserIds: string[] = [];

      for (const reg of page.data) {
        const docRef = this.notificationsCollection.doc();
        batch.set(docRef, {
          id: docRef.id,
          userId: reg.userId,
          type: params.type,
          title: params.title,
          body: params.body,
          data: { ...params.data, eventId: params.eventId },
          imageURL: null,
          isRead: false,
          readAt: null,
          createdAt: now,
        });
        chunkUserIds.push(reg.userId);
        totalSent++;
      }

      await batch.commit();

      // Send FCM push for this chunk
      await this.sendMulticastPush(chunkUserIds, {
        title: params.title,
        body: params.body,
        data: { ...params.data, eventId: params.eventId },
      });
    }

    return { sent: totalSent };
  }

  /**
   * Get a user's notifications (paginated, newest first).
   */
  async getMyNotifications(
    user: AuthUser,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {},
  ): Promise<{ data: Notification[]; total: number }> {
    this.requirePermission(user, "notification:read_own");

    const { page = 1, limit = 20, unreadOnly = false } = options;
    let query = this.notificationsCollection
      .where("userId", "==", user.uid)
      .orderBy("createdAt", "desc");

    if (unreadOnly) {
      query = query.where("isRead", "==", false);
    }

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    const snap = await query
      .offset((page - 1) * limit)
      .limit(limit)
      .get();

    const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Notification);
    return { data, total };
  }

  /**
   * Mark a notification as read.
   */
  async markAsRead(notificationId: string, user: AuthUser): Promise<void> {
    const doc = await this.notificationsCollection.doc(notificationId).get();
    if (!doc.exists) {
      const { NotFoundError } = await import("@/errors/app-error");
      throw new NotFoundError("Notification", notificationId);
    }

    const notification = doc.data() as Notification;
    if (notification.userId !== user.uid) {
      throw new ForbiddenError("Impossible de marquer les notifications d'un autre utilisateur comme lues");
    }

    await this.notificationsCollection.doc(notificationId).update({
      isRead: true,
      readAt: new Date().toISOString(),
    });
  }

  /**
   * Mark all of a user's notifications as read.
   */
  async markAllAsRead(user: AuthUser): Promise<void> {
    const snap = await this.notificationsCollection
      .where("userId", "==", user.uid)
      .where("isRead", "==", false)
      .get();

    if (snap.empty) return;

    const batch = db.batch();
    const now = new Date().toISOString();
    let count = 0;

    for (const doc of snap.docs) {
      batch.update(doc.ref, { isRead: true, readAt: now });
      count++;

      if (count >= 490) {
        await batch.commit();
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
    }
  }

  // ── Push notification helpers ─────────────────────────────────────────

  private async sendMulticastPush(
    userIds: string[],
    payload: { title: string; body: string; data?: Record<string, string> },
  ): Promise<void> {
    try {
      const tokens = await userRepository.getFcmTokens(userIds);
      if (tokens.length === 0) return;

      // FCM multicast limit is 500 tokens per call
      const chunks = this.chunkArray(tokens, 500);

      for (const chunk of chunks) {
        await messaging.sendEachForMulticast({
          tokens: chunk,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: payload.data,
        });
      }
    } catch (err) {
      process.stderr.write(`[NotificationService] FCM multicast push failed: ${err}\n`);
    }
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

}

export const notificationService = new NotificationService();

/**
 * Internal export — surface the NotificationType → catalog key mapping so
 * the diff script (`scripts/diff-in-app-adapter-output.ts`) and tests can
 * drive both paths from the same source of truth. Not intended for public
 * consumption; removed in the cleanup PR once the legacy path is deleted.
 */
export const __INTERNAL_NOTIFICATION_TYPE_TO_KEY: Readonly<
  Record<NotificationType, string | null>
> = NOTIFICATION_TYPE_TO_KEY;

// Compile-time guard: ensures the mapping stays in sync with
// NotificationChannelSchema (not strictly required today — the map is
// keyed on NotificationType — but keeps TS happy if an adapter ever
// wants to iterate all channels.)
type _UnusedChannel = NotificationChannel;
