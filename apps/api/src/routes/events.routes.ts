import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, optionalAuth } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { eventService } from "@/services/event.service";
import { uploadService } from "@/services/upload.service";
import {
  type CreateEventDto,
  type UpdateEventDto,
  type CreateTicketTypeDto,
  type UpdateTicketTypeDto,
  type UploadUrlRequest,
  type EventSearchQuery,
  CreateEventSchema,
  UpdateEventSchema,
  EventSearchQuerySchema,
  CreateTicketTypeSchema,
  UpdateTicketTypeSchema,
  UploadUrlRequestSchema,
} from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });
const TicketTypeParams = z.object({ eventId: z.string(), ticketTypeId: z.string() });

export const eventRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Search / List Published Events (public) ──────────────────────────────
  fastify.get(
    "/",
    {
      preHandler: [optionalAuth, validate({ query: EventSearchQuerySchema })],
      schema: { tags: ["Events"], summary: "Search published events" },
    },
    async (request, reply) => {
      const query = request.query as z.infer<typeof EventSearchQuerySchema>;
      const result = await eventService.search(query, request.user ?? undefined);
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
      const event = await eventService.getById(eventId, request.user ?? undefined);
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
      const event = await eventService.create(request.body as CreateEventDto, request.user!);
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
      await eventService.update(eventId, request.body as UpdateEventDto, request.user!);
      const updated = await eventService.getById(eventId, request.user!);
      return reply.send({ success: true, data: updated });
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

  // ─── Unpublish Event ─────────────────────────────────────────────────────
  fastify.post(
    "/:eventId/unpublish",
    {
      preHandler: [authenticate, requirePermission("event:publish"), validate({ params: ParamsWithEventId })],
      schema: { tags: ["Events"], summary: "Unpublish an event (revert to draft)", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      await eventService.unpublish(eventId, request.user!);
      return reply.send({ success: true, data: { id: eventId, status: "draft" } });
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

  // ─── Ticket Type: Add ───────────────────────────────────────────────────
  fastify.post(
    "/:eventId/ticket-types",
    {
      preHandler: [
        authenticate,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId, body: CreateTicketTypeSchema }),
      ],
      schema: { tags: ["Events"], summary: "Add a ticket type to an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const event = await eventService.addTicketType(eventId, request.body as CreateTicketTypeDto, request.user!);
      return reply.status(201).send({ success: true, data: event });
    },
  );

  // ─── Ticket Type: Update ────────────────────────────────────────────────
  fastify.patch(
    "/:eventId/ticket-types/:ticketTypeId",
    {
      preHandler: [
        authenticate,
        requirePermission("event:update"),
        validate({ params: TicketTypeParams, body: UpdateTicketTypeSchema }),
      ],
      schema: { tags: ["Events"], summary: "Update a ticket type", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId, ticketTypeId } = request.params as z.infer<typeof TicketTypeParams>;
      const event = await eventService.updateTicketType(eventId, ticketTypeId, request.body as UpdateTicketTypeDto, request.user!);
      return reply.send({ success: true, data: event });
    },
  );

  // ─── Ticket Type: Remove ────────────────────────────────────────────────
  fastify.delete(
    "/:eventId/ticket-types/:ticketTypeId",
    {
      preHandler: [
        authenticate,
        requirePermission("event:update"),
        validate({ params: TicketTypeParams }),
      ],
      schema: { tags: ["Events"], summary: "Remove a ticket type", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId, ticketTypeId } = request.params as z.infer<typeof TicketTypeParams>;
      await eventService.removeTicketType(eventId, ticketTypeId, request.user!);
      return reply.status(204).send();
    },
  );

  // ─── Upload URL for Event Images ────────────────────────────────────────
  fastify.post(
    "/:eventId/upload-url",
    {
      preHandler: [
        authenticate,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId, body: UploadUrlRequestSchema }),
      ],
      schema: { tags: ["Events"], summary: "Get a signed upload URL for event images", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const result = await uploadService.generateUploadUrl("event", eventId, request.body as UploadUrlRequest, request.user!);
      return reply.send({ success: true, data: result });
    },
  );
};
