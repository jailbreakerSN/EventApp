import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { venueService } from "@/services/venue.service";
import { VenueQuerySchema, CreateVenueSchema, UpdateVenueSchema } from "@teranga/shared-types";

const ParamsVenueId = z.object({ venueId: z.string() });

const PaginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ─── Venue Routes ───────────────────────────────────────────────────────────

export const venueRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Public: List approved venues ─────────────────────────────────────────

  fastify.get(
    "/",
    {
      preHandler: [validate({ query: VenueQuerySchema })],
      schema: {
        tags: ["Venues"],
        summary: "List approved venues (public)",
      },
    },
    async (request, reply) => {
      const query = request.query as z.infer<typeof VenueQuerySchema>;
      const result = await venueService.listPublic(query);
      return reply.send({ success: true, ...result });
    },
  );

  // ── Auth: List host's own venues ─────────────────────────────────────────
  // MUST be registered before /:venueId to avoid "mine" matching as a venueId

  fastify.get(
    "/mine",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Venues"],
        summary: "List venues owned by the authenticated user's organization",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const result = await venueService.listHostVenues(request.user!);
      return reply.send({ success: true, ...result });
    },
  );

  // ── Public: Get venue by ID ──────────────────────────────────────────────

  fastify.get(
    "/:venueId",
    {
      preHandler: [validate({ params: ParamsVenueId })],
      schema: {
        tags: ["Venues"],
        summary: "Get venue details (public)",
      },
    },
    async (request, reply) => {
      const { venueId } = request.params as z.infer<typeof ParamsVenueId>;
      const venue = await venueService.getById(venueId);
      return reply.send({ success: true, data: venue });
    },
  );

  // ── Public: List events at a venue ───────────────────────────────────────

  fastify.get(
    "/:venueId/events",
    {
      preHandler: [validate({ params: ParamsVenueId, query: PaginationQuery })],
      schema: {
        tags: ["Venues"],
        summary: "List events at a venue (public)",
      },
    },
    async (request, reply) => {
      const { venueId } = request.params as z.infer<typeof ParamsVenueId>;
      const { page, limit } = request.query as z.infer<typeof PaginationQuery>;
      const result = await venueService.getVenueEvents(venueId, { page, limit });
      return reply.send({ success: true, ...result });
    },
  );

  // ── Auth: Create venue ───────────────────────────────────────────────────

  fastify.post(
    "/",
    {
      preHandler: [
        authenticate,
        requirePermission("venue:create"),
        validate({ body: CreateVenueSchema }),
      ],
      schema: {
        tags: ["Venues"],
        summary: "Create a new venue",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const dto = request.body as z.infer<typeof CreateVenueSchema>;
      const venue = await venueService.create(dto, request.user!);
      return reply.status(201).send({ success: true, data: venue });
    },
  );

  // ── Auth: Update venue ───────────────────────────────────────────────────

  fastify.patch(
    "/:venueId",
    {
      preHandler: [
        authenticate,
        requirePermission("venue:update"),
        validate({ params: ParamsVenueId, body: UpdateVenueSchema }),
      ],
      schema: {
        tags: ["Venues"],
        summary: "Update a venue",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { venueId } = request.params as z.infer<typeof ParamsVenueId>;
      const dto = request.body as z.infer<typeof UpdateVenueSchema>;
      await venueService.update(venueId, dto, request.user!);
      return reply.status(204).send();
    },
  );

  // ── Auth: Approve venue (admin) ──────────────────────────────────────────

  fastify.post(
    "/:venueId/approve",
    {
      preHandler: [
        authenticate,
        requirePermission("venue:approve"),
        validate({ params: ParamsVenueId }),
      ],
      schema: {
        tags: ["Venues"],
        summary: "Approve a pending venue",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { venueId } = request.params as z.infer<typeof ParamsVenueId>;
      await venueService.approve(venueId, request.user!);
      return reply.status(204).send();
    },
  );

  // ── Auth: Suspend venue (admin) ──────────────────────────────────────────

  fastify.post(
    "/:venueId/suspend",
    {
      preHandler: [
        authenticate,
        requirePermission("venue:manage_all"),
        validate({ params: ParamsVenueId }),
      ],
      schema: {
        tags: ["Venues"],
        summary: "Suspend a venue",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { venueId } = request.params as z.infer<typeof ParamsVenueId>;
      await venueService.suspend(venueId, request.user!);
      return reply.status(204).send();
    },
  );

  // ── Auth: Reactivate venue (admin) ───────────────────────────────────────

  fastify.post(
    "/:venueId/reactivate",
    {
      preHandler: [
        authenticate,
        requirePermission("venue:manage_all"),
        validate({ params: ParamsVenueId }),
      ],
      schema: {
        tags: ["Venues"],
        summary: "Reactivate a suspended venue",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { venueId } = request.params as z.infer<typeof ParamsVenueId>;
      await venueService.reactivate(venueId, request.user!);
      return reply.status(204).send();
    },
  );
};
