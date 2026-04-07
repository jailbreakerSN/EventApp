import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { broadcastService } from "@/services/broadcast.service";
import { CreateBroadcastSchema, BroadcastQuerySchema } from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });

export const communicationRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Send Broadcast ───────────────────────────────────────────────────
  fastify.post(
    "/:eventId/broadcast",
    {
      preHandler: [
        authenticate,
        requirePermission("broadcast:send"),
        validate({ params: ParamsWithEventId, body: CreateBroadcastSchema }),
      ],
      schema: {
        tags: ["Communications"],
        summary: "Send a broadcast to event participants",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const dto = request.body as z.infer<typeof CreateBroadcastSchema>;
      const broadcast = await broadcastService.sendBroadcast(dto, request.user!);
      return reply.status(201).send({ success: true, data: broadcast });
    },
  );

  // ─── List Broadcasts ──────────────────────────────────────────────────
  fastify.get(
    "/:eventId/broadcasts",
    {
      preHandler: [
        authenticate,
        requirePermission("broadcast:read"),
        validate({ params: ParamsWithEventId, query: BroadcastQuerySchema }),
      ],
      schema: {
        tags: ["Communications"],
        summary: "List broadcast history for an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { status, page, limit } = request.query as z.infer<typeof BroadcastQuerySchema>;
      const result = await broadcastService.listBroadcasts(
        eventId,
        { status },
        { page: page ?? 1, limit: limit ?? 20 },
        request.user!,
      );
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );
};
