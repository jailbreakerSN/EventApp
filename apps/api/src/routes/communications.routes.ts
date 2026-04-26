import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { broadcastService } from "@/services/broadcast.service";
import { commsTimelineService } from "@/services/comms-timeline.service";
import { commsTemplateService } from "@/services/comms-template.service";
import {
  CreateBroadcastSchema,
  BroadcastQuerySchema,
  CommsTemplateCategorySchema,
} from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });

export const communicationRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Send Broadcast ───────────────────────────────────────────────────
  fastify.post(
    "/:eventId/broadcast",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
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

  // ─── Comms Timeline (Phase O5 — organizer overhaul) ───────────────────
  // Aggregates every comm scheduled/sent for the event into a
  // chronological list, exploded per channel. Read-only.
  fastify.get(
    "/:eventId/comms/timeline",
    {
      preHandler: [
        authenticate,
        requirePermission("broadcast:read"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["Communications"],
        summary: "Aggregated comms timeline for the Comms Center",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const data = await commsTimelineService.getEventTimeline(eventId, request.user!);
      return reply.send({ success: true, data });
    },
  );
};

/**
 * Org-scoped comms routes — templates library + future custom-template
 * CRUD. Registered under `/v1/comms` (NOT `/v1/events`) because the
 * templates collection is not event-scoped.
 */
export const commsRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Comms Templates Library (Phase O5) ───────────────────────────────
  // Static FR templates shipped with the product. Returns all 12 by
  // default; ?category=reminder|confirmation|lifecycle|reengagement
  // filters by tab.
  fastify.get(
    "/templates",
    {
      preHandler: [
        authenticate,
        requirePermission("broadcast:read"),
        validate({
          query: z.object({ category: CommsTemplateCategorySchema.optional() }),
        }),
      ],
      schema: {
        tags: ["Communications"],
        summary: "List the seeded communications templates",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { category } = request.query as {
        category?: z.infer<typeof CommsTemplateCategorySchema>;
      };
      const templates = commsTemplateService.list(request.user!, { category });
      return reply.send({ success: true, data: templates });
    },
  );
};
