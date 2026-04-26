/**
 * Organizer overhaul — Phase O10.
 *
 * Event templates surface — list the catalog + clone a new event from
 * one. Mounted under `/v1/event-templates/*`.
 *
 * Both endpoints require `event:create`.
 */

import type { FastifyPluginAsync } from "fastify";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { eventTemplateService } from "@/services/event-template.service";
import { CloneFromTemplateSchema } from "@teranga/shared-types";

export const eventTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── List catalog ──────────────────────────────────────────────────
  fastify.get(
    "/",
    {
      preHandler: [authenticate, requirePermission("event:create")],
      schema: {
        tags: ["EventTemplates"],
        summary: "List the 8 starter templates available to organizers",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const data = eventTemplateService.list(request.user!);
      return reply.send({ success: true, data });
    },
  );

  // ─── Clone (create event from template) ───────────────────────────
  fastify.post(
    "/clone",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:create"),
        validate({ body: CloneFromTemplateSchema }),
      ],
      schema: {
        tags: ["EventTemplates"],
        summary: "Materialise a template into a new event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const dto = request.body as Parameters<typeof eventTemplateService.cloneFromTemplate>[0];
      const result = await eventTemplateService.cloneFromTemplate(dto, request.user!);
      return reply.status(201).send({ success: true, data: result });
    },
  );
};
