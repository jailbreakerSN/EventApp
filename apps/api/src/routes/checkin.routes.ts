import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { checkinService } from "@/services/checkin.service";
import {
  BulkCheckinRequestSchema,
  CheckinHistoryQuerySchema,
  type BulkCheckinRequest,
  type CheckinHistoryQuery,
} from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });

export const checkinRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Offline Sync Data ─────────────────────────────────────────────────────
  fastify.get(
    "/:eventId/sync",
    {
      preHandler: [
        authenticate,
        validate({ params: ParamsWithEventId }),
        requirePermission("checkin:sync_offline"),
      ],
      schema: { tags: ["Check-in"], summary: "Get offline sync data for event" },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const data = await checkinService.getOfflineSyncData(eventId, request.user!);
      return reply.send({ success: true, data });
    },
  );

  // ─── Bulk Check-in Sync ────────────────────────────────────────────────────
  fastify.post(
    "/:eventId/checkin/sync",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        validate({ params: ParamsWithEventId, body: BulkCheckinRequestSchema }),
        requirePermission("checkin:scan"),
      ],
      schema: { tags: ["Check-in"], summary: "Sync offline check-ins" },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { items } = request.body as BulkCheckinRequest;
      const result = await checkinService.bulkSync(eventId, items, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Check-in History ──────────────────────────────────────────────────────
  fastify.get(
    "/:eventId/checkin/history",
    {
      preHandler: [
        authenticate,
        validate({ params: ParamsWithEventId, query: CheckinHistoryQuerySchema }),
        requirePermission("checkin:view_log"),
      ],
      schema: { tags: ["Check-in"], summary: "Get paginated check-in history", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const query = request.query as CheckinHistoryQuery;
      const result = await checkinService.getHistory(eventId, query, request.user!);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Check-in Statistics ───────────────────────────────────────────────────
  fastify.get(
    "/:eventId/checkin/stats",
    {
      preHandler: [
        authenticate,
        validate({ params: ParamsWithEventId }),
        requirePermission("checkin:view_log"),
      ],
      schema: { tags: ["Check-in"], summary: "Get check-in statistics" },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const stats = await checkinService.getStats(eventId, request.user!);
      return reply.send({ success: true, data: stats });
    },
  );
};
