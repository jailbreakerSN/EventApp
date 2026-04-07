import {
  type Notification,
  type NotificationType,
} from "@teranga/shared-types";
import { type DocumentSnapshot } from "firebase-admin/firestore";
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

// ─── Service ─────────────────────────────────────────────────────────────────

export class NotificationService extends BaseService {
  private get notificationsCollection() {
    return db.collection(COLLECTIONS.NOTIFICATIONS);
  }

  /**
   * Send a notification to a single user.
   * Creates Firestore notification doc + sends FCM push.
   */
  async send(params: SendNotificationParams): Promise<Notification> {
    const { userId, type, title, body, data, imageURL } = params;

    // Create in-app notification
    const now = new Date().toISOString();
    const docRef = this.notificationsCollection.doc();
    const notification: Notification = {
      id: docRef.id,
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

    await docRef.set(notification);

    // Send FCM push (fire and forget — failures are logged, not thrown)
    await this.sendPush(userId, { title, body, data, imageURL });

    return notification;
  }

  /**
   * Broadcast a notification to all confirmed participants of an event.
   * Uses cursor-based pagination to avoid loading all registrations into memory.
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

  private async sendPush(
    userId: string,
    payload: { title: string; body: string; data?: Record<string, string>; imageURL?: string },
  ): Promise<void> {
    try {
      const tokens = await userRepository.getFcmTokens([userId]);
      if (tokens.length === 0) return;

      await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.imageURL && { imageUrl: payload.imageURL }),
        },
        data: payload.data,
      });
    } catch (err) {
      // Push failures should not break the flow
      process.stderr.write(`[NotificationService] FCM push failed for user ${userId}: ${err}\n`);
    }
  }

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
