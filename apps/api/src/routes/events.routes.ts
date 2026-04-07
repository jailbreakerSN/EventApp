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
  type CreateAccessZoneDto,
  type UpdateAccessZoneDto,
  type CloneEventDto,
  type UploadUrlRequest,
  type EventSearchQuery,
  CreateEventSchema,
  UpdateEventSchema,
  EventSearchQuerySchema,
  CreateTicketTypeSchema,
  UpdateTicketTypeSchema,
  CreateAccessZoneSchema,
  UpdateAccessZoneSchema,
  CloneEventSchema,
  UploadUrlRequestSchema,
  PaginationSchema,
} from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });
const TicketTypeParams = z.object({ eventId: z.string(), ticketTypeId: z.string() });
const AccessZoneParams = z.object({ eventId: z.string(), zoneId: z.string() });

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

  // ─── List Organization Events (backoffice — all statuses) ──────────────
  fastify.get(
    "/org/:orgId",
    {
      preHandler: [
        authenticate,
        requirePermission("event:read"),
        validate({ params: z.object({ orgId: z.string() }), query: PaginationSchema }),
      ],
      schema: { tags: ["Events"], summary: "List all events for an organization (requires org membership)", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const pagination = request.query as z.infer<typeof PaginationSchema>;
      const result = await eventService.listByOrganization(orgId, request.user!, pagination);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Get Event by Slug (public if published — for SEO pages) ──────────────
  fastify.get(
    "/by-slug/:slug",
    {
      preHandler: [optionalAuth, validate({ params: z.object({ slug: z.string() }) })],
      schema: { tags: ["Events"], summary: "Get event by slug (public if published)" },
    },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const event = await eventService.getBySlug(slug, request.user ?? undefined);
      return reply.send({ success: true, data: event });
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

  // ─── Access Zone: Add ───────────────────────────────────────────────────
  fastify.post(
    "/:eventId/access-zones",
    {
      preHandler: [
        authenticate,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId, body: CreateAccessZoneSchema }),
      ],
      schema: { tags: ["Events"], summary: "Add an access zone", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const event = await eventService.addAccessZone(eventId, request.body as CreateAccessZoneDto, request.user!);
      return reply.status(201).send({ success: true, data: event });
    },
  );

  // ─── Access Zone: Update ───────────────────────────────────────────────
  fastify.patch(
    "/:eventId/access-zones/:zoneId",
    {
      preHandler: [
        authenticate,
        requirePermission("event:update"),
        validate({ params: AccessZoneParams, body: UpdateAccessZoneSchema }),
      ],
      schema: { tags: ["Events"], summary: "Update an access zone", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId, zoneId } = request.params as z.infer<typeof AccessZoneParams>;
      const event = await eventService.updateAccessZone(eventId, zoneId, request.body as UpdateAccessZoneDto, request.user!);
      return reply.send({ success: true, data: event });
    },
  );

  // ─── Access Zone: Remove ───────────────────────────────────────────────
  fastify.delete(
    "/:eventId/access-zones/:zoneId",
    {
      preHandler: [
        authenticate,
        requirePermission("event:update"),
        validate({ params: AccessZoneParams }),
      ],
      schema: { tags: ["Events"], summary: "Remove an access zone", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId, zoneId } = request.params as z.infer<typeof AccessZoneParams>;
      await eventService.removeAccessZone(eventId, zoneId, request.user!);
      return reply.status(204).send();
    },
  );

  // ─── Clone Event ─────────────────────────────────────────────────────────
  fastify.post(
    "/:eventId/clone",
    {
      preHandler: [
        authenticate,
        requirePermission("event:create"),
        validate({ params: ParamsWithEventId, body: CloneEventSchema }),
      ],
      schema: { tags: ["Events"], summary: "Clone an event with new dates", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const cloned = await eventService.clone(eventId, request.body as CloneEventDto, request.user!);
      return reply.status(201).send({ success: true, data: cloned });
    },
  );

  // ─── Calendar (.ics) Export (public for published events) ───────────────
  fastify.get(
    "/:eventId/calendar.ics",
    {
      preHandler: [validate({ params: ParamsWithEventId })],
      schema: { tags: ["Events"], summary: "Download event as .ics calendar file (public)" },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const event = await eventService.getById(eventId);

      // Format dates to iCalendar format (YYYYMMDDTHHMMSSZ)
      const formatIcsDate = (iso: string): string => {
        return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      };

      const dtStart = formatIcsDate(event.startDate);
      const dtEnd = formatIcsDate(event.endDate);
      const description = event.description
        ? event.description.substring(0, 500).replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;")
        : "";
      const locationParts = [
        event.location?.name,
        event.location?.address,
        event.location?.city,
      ].filter(Boolean);
      const location = locationParts.join(", ").replace(/,/g, "\\,");
      const summary = event.title.replace(/,/g, "\\,").replace(/;/g, "\\;");
      const now = formatIcsDate(new Date().toISOString());

      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Teranga Events//FR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `DTSTAMP:${now}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        `LOCATION:${location}`,
        `URL:https://teranga.sn/events/${event.slug}`,
        `UID:${event.id}@teranga.events`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");

      return reply
        .header("Content-Type", "text/calendar; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${event.slug || event.id}.ics"`)
        .send(ics);
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
