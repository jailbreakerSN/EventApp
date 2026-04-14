import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { notificationService } from "@/services/notification.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { UpdateNotificationPreferenceSchema } from "@teranga/shared-types";

const ParamsWithNotificationId = z.object({ notificationId: z.string() });

const NotificationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unreadOnly: z.coerce.boolean().optional(),
});

export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Get My Notifications ─────────────────────────────────────────────
  fastify.get(
    "/",
    {
      preHandler: [
        authenticate,
        requirePermission("notification:read_own"),
        validate({ query: NotificationQuery }),
      ],
      schema: {
        tags: ["Notifications"],
        summary: "Get my notifications",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { page, limit, unreadOnly } = request.query as z.infer<typeof NotificationQuery>;
      const result = await notificationService.getMyNotifications(request.user!, {
        page,
        limit,
        unreadOnly,
      });
      return reply.send({ success: true, data: result.data, meta: { total: result.total } });
    },
  );

  // ─── Unread Count ─────────────────────────────────────────────────────
  fastify.get(
    "/unread-count",
    {
      preHandler: [authenticate, requirePermission("notification:read_own")],
      schema: {
        tags: ["Notifications"],
        summary: "Get unread notification count",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const snap = await db.collection(COLLECTIONS.NOTIFICATIONS)
        .where("userId", "==", request.user!.uid)
        .where("isRead", "==", false)
        .count()
        .get();
      return reply.send({ success: true, data: { count: snap.data().count } });
    },
  );

  // ─── Mark as Read ─────────────────────────────────────────────────────
  fastify.patch(
    "/:notificationId/read",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("notification:read_own"),
        validate({ params: ParamsWithNotificationId }),
      ],
      schema: {
        tags: ["Notifications"],
        summary: "Mark a notification as read",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { notificationId } = request.params as z.infer<typeof ParamsWithNotificationId>;
      await notificationService.markAsRead(notificationId, request.user!);
      return reply.send({ success: true });
    },
  );

  // ─── Mark All as Read ─────────────────────────────────────────────────
  fastify.patch(
    "/read-all",
    {
      preHandler: [authenticate, requirePermission("notification:read_own")],
      schema: {
        tags: ["Notifications"],
        summary: "Mark all notifications as read",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      await notificationService.markAllAsRead(request.user!);
      return reply.send({ success: true });
    },
  );

  // ─── Get Notification Preferences ─────────────────────────────────────
  fastify.get(
    "/preferences",
    {
      preHandler: [authenticate, requirePermission("notification:read_own")],
      schema: {
        tags: ["Notifications"],
        summary: "Get notification preferences",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const doc = await db.collection(COLLECTIONS.NOTIFICATION_PREFERENCES).doc(request.user!.uid).get();
      if (!doc.exists) {
        // Return defaults
        return reply.send({
          success: true,
          data: {
            id: request.user!.uid,
            userId: request.user!.uid,
            email: true,
            sms: true,
            push: true,
            quietHoursStart: null,
            quietHoursEnd: null,
            updatedAt: new Date().toISOString(),
          },
        });
      }
      return reply.send({ success: true, data: doc.data() });
    },
  );

  // ─── Update Notification Preferences ──────────────────────────────────
  fastify.put(
    "/preferences",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("notification:read_own"),
        validate({ body: UpdateNotificationPreferenceSchema }),
      ],
      schema: {
        tags: ["Notifications"],
        summary: "Update notification preferences",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const updates = request.body as z.infer<typeof UpdateNotificationPreferenceSchema>;
      const ref = db.collection(COLLECTIONS.NOTIFICATION_PREFERENCES).doc(request.user!.uid);
      const now = new Date().toISOString();

      await ref.set(
        {
          id: request.user!.uid,
          userId: request.user!.uid,
          ...updates,
          updatedAt: now,
        },
        { merge: true },
      );

      const doc = await ref.get();
      return reply.send({ success: true, data: doc.data() });
    },
  );
};
