import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified, optionalAuth } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { eventService } from "@/services/event.service";
import { eventHealthService } from "@/services/event-health.service";
import { registrationService } from "@/services/registration.service";
import { eventRepository } from "@/repositories/event.repository";
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
  EventCategorySchema,
  EventStatusSchema,
  SetScanPolicySchema,
  type SetScanPolicyDto,
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
  // Query params: closed pagination + optional `category` and `status` for
  // server-side filtering. Keeping the filter on the server lets the UI
  // paginate correctly when a filter is applied (client-side filtering
  // over a single page silently hides matching records on later pages).
  //
  // `orderBy` is intentionally CLOSED to a 2-value enum — staging shipped
  // a 500 on /v1/events/org/:orgId because the inherited `PaginationSchema`
  // accepted `orderBy: "startDate"` from the back-office UI but Firestore
  // had no `(organizationId, startDate)` composite index. The closed enum
  // lets `scripts/audit-firestore-indexes.ts` expand both reachable values
  // through its Zod-discovery pass so every required index is gated by CI.
  const OrgEventsQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25),
    orderBy: z.enum(["startDate", "createdAt"]).default("startDate"),
    orderDir: z.enum(["asc", "desc"]).default("desc"),
    category: EventCategorySchema.optional(),
    status: EventStatusSchema.optional(),
  });
  // Reference the import so the linter doesn't complain about it after
  // the local schema replaced the previous PaginationSchema spread.
  void PaginationSchema;
  fastify.get(
    "/org/:orgId",
    {
      preHandler: [
        authenticate,
        requirePermission("event:read"),
        validate({ params: z.object({ orgId: z.string() }), query: OrgEventsQuerySchema }),
      ],
      schema: {
        tags: ["Events"],
        summary: "List all events for an organization (requires org membership)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const { category, status, ...pagination } = request.query as z.infer<
        typeof OrgEventsQuerySchema
      >;
      const result = await eventService.listByOrganization(orgId, request.user!, pagination, {
        category,
        status,
      });
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

  // ─── Get Event Health Score (Phase O3 — organizer overhaul) ───────────────
  // Composite score 0-100 + pacing trajectory. Permission gate inside the
  // service (`event:read` baseline + requireOrganizationAccess), so the
  // route stays a thin controller.
  fastify.get(
    "/:eventId/health",
    {
      preHandler: [authenticate, validate({ params: ParamsWithEventId })],
      schema: {
        tags: ["Events"],
        summary:
          "Compute the event health score (publication, tickets, venue, pace, comms, staff, checkin) + pacing trajectory",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const data = await eventHealthService.getEventHealth(eventId, request.user!);
      return reply.send({ success: true, data });
    },
  );

  // ─── Create Event ────────────────────────────────────────────────────────
  fastify.post(
    "/",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:create"),
        validate({ body: CreateEventSchema }),
      ],
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
        requireEmailVerified,
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
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:publish"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: { tags: ["Events"], summary: "Publish an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      await eventService.publish(eventId, request.user!);
      return reply.send({ success: true, data: { id: eventId, status: "published" } });
    },
  );

  // ─── Publish Series (Phase 7+ item #B1) ─────────────────────────────────
  // Publishes a recurring-event series: parent + every child
  // atomically. Requires `event:publish`. Rejects non-parent event ids.
  fastify.post(
    "/:eventId/publish-series",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:publish"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Publish a recurring event series (parent + all children)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const result = await eventService.publishSeries(eventId, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // Sprint-2 S1 closure — cancel an entire recurring series in one
  // atomic call. Requires `event:update` (same as per-event cancel).
  fastify.post(
    "/:eventId/cancel-series",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Cancel a recurring event series (parent + every child)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const result = await eventService.cancelSeries(eventId, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Bulk-promote Waitlist (B2 — Phase 7+) ──────────────────────────────
  // Replaces the backoffice's per-registration loop with a single
  // round-trip. `count` caps at 100 (server-side guard); the typical
  // organizer use case is "promote 5/10/all next" after raising
  // `maxAttendees` or after a wave of cancellations. Optional
  // `ticketTypeId` scopes promotions to a tier — without it, promotion
  // walks the global FIFO across all tiers (oldest first).
  fastify.post(
    "/:eventId/waitlist/promote-batch",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("registration:approve"),
        validate({
          params: ParamsWithEventId,
          body: z.object({
            // Cap at 25 (down from 100 in early B2) so a single
            // request can't trigger a 100-message burst on the email
            // provider — see the senior review remediation note in
            // `bulkPromoteWaitlisted`. Larger waitlist purges should
            // be staged via the admin job runner.
            count: z.coerce.number().int().min(1).max(25),
            ticketTypeId: z.string().optional(),
          }),
        }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Bulk-promote waitlisted registrations (FIFO, optionally per ticket type)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { count, ticketTypeId } = request.body as {
        count: number;
        ticketTypeId?: string;
      };
      // Resolve the org id from the event so the service's
      // requireOrganizationAccess gate doesn't have to take the
      // eventId. Cheap one-doc read; keeps the service signature org-
      // scoped (consistent with every other registration mutation).
      const event = await eventRepository.findByIdOrThrow(eventId);
      const result = await registrationService.bulkPromoteWaitlisted(
        eventId,
        event.organizationId,
        request.user!,
        count,
        ticketTypeId,
      );
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Unpublish Event ─────────────────────────────────────────────────────
  fastify.post(
    "/:eventId/unpublish",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:publish"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Unpublish an event (revert to draft)",
        security: [{ BearerAuth: [] }],
      },
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
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId }),
      ],
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
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:delete"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: { tags: ["Events"], summary: "Archive an event", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      await eventService.archive(eventId, request.user!);
      return reply.status(204).send();
    },
  );

  // T2.2 closure — undo a recent archive within the 30-day window.
  // Returns the event to `status: "draft"` (organizer must
  // re-publish consciously before participants see it again).
  // Refuses cancellations (those have stronger downstream effects).
  fastify.post<{ Params: z.infer<typeof ParamsWithEventId> }>(
    "/:eventId/restore",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:delete"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Restore a recently archived event (within 30 days)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params;
      const data = await eventService.restore(eventId, request.user!);
      return reply.send({ success: true, data });
    },
  );

  // ─── Rotate QR signing key ───────────────────────────────────────────────
  // Organizer-driven after a suspected key leak (lost staff device, etc.).
  // New registrations sign under the new `kid`; already-issued badges keep
  // verifying because the retired `kid` stays in `qrKidHistory`.
  fastify.post(
    "/:eventId/qr-key/rotate",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Rotate the event's QR signing key",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const result = await eventService.rotateQrKey(eventId, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Set scan policy ─────────────────────────────────────────────────────
  // Flip the event's scanPolicy between single / multi_day / multi_zone.
  // Dedicated endpoint (vs overloading /events PATCH) because the flip
  // has real behavioural consequences on the scan pipeline — worth
  // making the caller's intent explicit.
  fastify.post(
    "/:eventId/scan-policy",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId, body: SetScanPolicySchema }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Set the event's scan policy (single / multi_day / multi_zone)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { policy } = request.body as SetScanPolicyDto;
      const result = await eventService.setScanPolicy(eventId, policy, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Ticket Type: Add ───────────────────────────────────────────────────
  fastify.post(
    "/:eventId/ticket-types",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId, body: CreateTicketTypeSchema }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Add a ticket type to an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const event = await eventService.addTicketType(
        eventId,
        request.body as CreateTicketTypeDto,
        request.user!,
      );
      return reply.status(201).send({ success: true, data: event });
    },
  );

  // ─── Ticket Type: Update ────────────────────────────────────────────────
  fastify.patch(
    "/:eventId/ticket-types/:ticketTypeId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: TicketTypeParams, body: UpdateTicketTypeSchema }),
      ],
      schema: { tags: ["Events"], summary: "Update a ticket type", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId, ticketTypeId } = request.params as z.infer<typeof TicketTypeParams>;
      const event = await eventService.updateTicketType(
        eventId,
        ticketTypeId,
        request.body as UpdateTicketTypeDto,
        request.user!,
      );
      return reply.send({ success: true, data: event });
    },
  );

  // ─── Ticket Type: Remove ────────────────────────────────────────────────
  fastify.delete(
    "/:eventId/ticket-types/:ticketTypeId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
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
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId, body: CreateAccessZoneSchema }),
      ],
      schema: { tags: ["Events"], summary: "Add an access zone", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const event = await eventService.addAccessZone(
        eventId,
        request.body as CreateAccessZoneDto,
        request.user!,
      );
      return reply.status(201).send({ success: true, data: event });
    },
  );

  // ─── Access Zone: Update ───────────────────────────────────────────────
  fastify.patch(
    "/:eventId/access-zones/:zoneId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: AccessZoneParams, body: UpdateAccessZoneSchema }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Update an access zone",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId, zoneId } = request.params as z.infer<typeof AccessZoneParams>;
      const event = await eventService.updateAccessZone(
        eventId,
        zoneId,
        request.body as UpdateAccessZoneDto,
        request.user!,
      );
      return reply.send({ success: true, data: event });
    },
  );

  // ─── Access Zone: Remove ───────────────────────────────────────────────
  fastify.delete(
    "/:eventId/access-zones/:zoneId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: AccessZoneParams }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Remove an access zone",
        security: [{ BearerAuth: [] }],
      },
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
        requireEmailVerified,
        requirePermission("event:create"),
        validate({ params: ParamsWithEventId, body: CloneEventSchema }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Clone an event with new dates",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const cloned = await eventService.clone(
        eventId,
        request.body as CloneEventDto,
        request.user!,
      );
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
        return new Date(iso)
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}/, "");
      };

      const dtStart = formatIcsDate(event.startDate);
      const dtEnd = formatIcsDate(event.endDate);
      const description = event.description
        ? event.description
            .substring(0, 500)
            .replace(/\n/g, "\\n")
            .replace(/,/g, "\\,")
            .replace(/;/g, "\\;")
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
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: ParamsWithEventId, body: UploadUrlRequestSchema }),
      ],
      schema: {
        tags: ["Events"],
        summary: "Get a signed upload URL for event images",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const result = await uploadService.generateUploadUrl(
        "event",
        eventId,
        request.body as UploadUrlRequest,
        request.user!,
      );
      return reply.send({ success: true, data: result });
    },
  );
};
