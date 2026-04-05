import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, optionalAuth } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { eventService } from "@/services/event.service";
import {
  CreateEventSchema,
  UpdateEventSchema,
  PaginationSchema,
} from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });

const ListEventsQuery = z.object({
  ...PaginationSchema.shape,
  category: z.string().optional(),
  organizationId: z.string().optional(),
  featured: z.coerce.boolean().optional(),
});

export const eventRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── List Published Events (public) ──────────────────────────────────────
  fastify.get(
    "/",
    {
      preHandler: [validate({ query: ListEventsQuery })],
      schema: { tags: ["Events"], summary: "List published events" },
    },
    async (request, reply) => {
      const { page, limit, orderBy, orderDir, category, organizationId, featured } =
        request.query as z.infer<typeof ListEventsQuery>;

      const result = await eventService.listPublished(
        { category: category as any, organizationId, isFeatured: featured },
        { page, limit, orderBy, orderDir },
      );

      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Get Event by ID (public if published) ────────────────────────────────
  fastify.get(
    "/:eventId",
    {
      preHandler: [optionalAuth, validate({ params: ParamsWithEventId })],
      schema: { tags: ["Events"], summary: "Get event by ID" },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const event = await eventService.getById(eventId, request.user);
      return reply.send({ success: true, data: event });
    },
  );

  // ─── Create Event ────────────────────────────────────────────────────────
  fastify.post(
    "/",
    {
      preHandler: [authenticate, requirePermission("event:create"), validate({ body: CreateEventSchema })],
      schema: { tags: ["Events"], summary: "Create a new event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const event = await eventService.create(request.body as any, request.user!);
      return reply.status(201).send({ success: true, data: event });
    },
  );

  // ─── Update Event ────────────────────────────────────────────────────────
  fastify.patch(
    "/:eventId",
    {
      preHandler: [
        authenticate,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId, body: UpdateEventSchema }),
      ],
      schema: { tags: ["Events"], summary: "Update an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      await eventService.update(eventId, request.body as any, request.user!);
      return reply.send({ success: true, data: { id: eventId } });
    },
  );

  // ─── Publish Event ───────────────────────────────────────────────────────
  fastify.post(
    "/:eventId/publish",
    {
      preHandler: [authenticate, requirePermission("event:publish"), validate({ params: ParamsWithEventId })],
      schema: { tags: ["Events"], summary: "Publish an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      await eventService.publish(eventId, request.user!);
      return reply.send({ success: true, data: { id: eventId, status: "published" } });
    },
  );

  // ─── Cancel Event ────────────────────────────────────────────────────────
  fastify.post(
    "/:eventId/cancel",
    {
      preHandler: [authenticate, requirePermission("event:update"), validate({ params: ParamsWithEventId })],
      schema: { tags: ["Events"], summary: "Cancel an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      await eventService.cancel(eventId, request.user!);
      return reply.send({ success: true, data: { id: eventId, status: "cancelled" } });
    },
  );

  // ─── Archive (soft-delete) Event ─────────────────────────────────────────
  fastify.delete(
    "/:eventId",
    {
      preHandler: [authenticate, requirePermission("event:delete"), validate({ params: ParamsWithEventId })],
      schema: { tags: ["Events"], summary: "Archive an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      await eventService.archive(eventId, request.user!);
      return reply.status(204).send();
    },
  );
};
