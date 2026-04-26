/**
 * Organizer overhaul — Phase O8.
 *
 * Floor-ops API surface — incidents, staff messages, emergency
 * broadcast, live stats. Mounted under `/v1/events/:eventId/live`
 * so the URLs read naturally (`POST /v1/events/abc/live/incidents`).
 *
 * Permission gating happens inside each service — routes stay thin.
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { incidentService } from "@/services/incident.service";
import { staffMessageService } from "@/services/staff-message.service";
import { emergencyBroadcastService } from "@/services/emergency-broadcast.service";
import { liveStatsService } from "@/services/live-stats.service";
import {
  CreateIncidentSchema,
  UpdateIncidentSchema,
  CreateStaffMessageSchema,
  EmergencyBroadcastSchema,
  IncidentStatusSchema,
} from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string().min(1) });
const ParamsWithIncidentId = z.object({
  eventId: z.string().min(1),
  incidentId: z.string().min(1),
});
const IncidentListQuery = z.object({ status: IncidentStatusSchema.optional() });
const StaffMessageQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
});

export const liveOpsRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Live stats (dashboard) ──────────────────────────────────────────
  fastify.get(
    "/:eventId/live/stats",
    {
      preHandler: [
        authenticate,
        // Defense-in-depth: the service also enforces this permission.
        // Gating at the route layer keeps the route-inventory contract
        // explicit ("every authenticated GET that reads org-scoped data
        // declares its permission").
        requirePermission("checkin:view_log"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["LiveOps"],
        summary: "Aggregated live dashboard stats (scan rate, queue, no-show, staff online)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const data = await liveStatsService.getStats(eventId, request.user!);
      return reply.send({ success: true, data });
    },
  );

  // ─── Incidents ───────────────────────────────────────────────────────
  fastify.post(
    "/:eventId/live/incidents",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("checkin:scan"),
        validate({ params: ParamsWithEventId, body: CreateIncidentSchema }),
      ],
      schema: {
        tags: ["LiveOps"],
        summary: "Log a floor-ops incident",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const dto = request.body as z.infer<typeof CreateIncidentSchema>;
      const incident = await incidentService.create(eventId, dto, request.user!);
      return reply.status(201).send({ success: true, data: incident });
    },
  );

  fastify.get(
    "/:eventId/live/incidents",
    {
      preHandler: [
        authenticate,
        requirePermission("checkin:view_log"),
        validate({ params: ParamsWithEventId, query: IncidentListQuery }),
      ],
      schema: {
        tags: ["LiveOps"],
        summary: "List recent incidents",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { status } = request.query as z.infer<typeof IncidentListQuery>;
      const incidents = await incidentService.list(eventId, request.user!, { status });
      return reply.send({ success: true, data: incidents });
    },
  );

  fastify.patch(
    "/:eventId/live/incidents/:incidentId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: ParamsWithIncidentId, body: UpdateIncidentSchema }),
      ],
      schema: {
        tags: ["LiveOps"],
        summary: "Update an incident (status / assignee / resolution note)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { incidentId } = request.params as z.infer<typeof ParamsWithIncidentId>;
      const dto = request.body as z.infer<typeof UpdateIncidentSchema>;
      const next = await incidentService.update(incidentId, dto, request.user!);
      return reply.send({ success: true, data: next });
    },
  );

  // ─── Staff messages ──────────────────────────────────────────────────
  fastify.post(
    "/:eventId/live/staff-messages",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("checkin:scan"),
        validate({ params: ParamsWithEventId, body: CreateStaffMessageSchema }),
      ],
      schema: {
        tags: ["LiveOps"],
        summary: "Post a staff radio message for the event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const dto = request.body as z.infer<typeof CreateStaffMessageSchema>;
      const message = await staffMessageService.post(eventId, dto, request.user!);
      return reply.status(201).send({ success: true, data: message });
    },
  );

  fastify.get(
    "/:eventId/live/staff-messages",
    {
      preHandler: [
        authenticate,
        requirePermission("checkin:scan"),
        validate({ params: ParamsWithEventId, query: StaffMessageQuery }),
      ],
      schema: {
        tags: ["LiveOps"],
        summary: "List recent staff radio messages (cold-start fallback)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { limit } = request.query as z.infer<typeof StaffMessageQuery>;
      const messages = await staffMessageService.list(eventId, request.user!, limit);
      return reply.send({ success: true, data: messages });
    },
  );

  // ─── Emergency broadcast ─────────────────────────────────────────────
  fastify.post(
    "/:eventId/live/emergency-broadcast",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("broadcast:send"),
        validate({ params: ParamsWithEventId, body: EmergencyBroadcastSchema }),
      ],
      schema: {
        tags: ["LiveOps"],
        summary: "Send an emergency multi-channel broadcast (push + sms + whatsapp)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const dto = request.body as z.infer<typeof EmergencyBroadcastSchema>;
      const result = await emergencyBroadcastService.send(eventId, dto, request.user!);
      return reply.send({ success: true, data: result });
    },
  );
};
