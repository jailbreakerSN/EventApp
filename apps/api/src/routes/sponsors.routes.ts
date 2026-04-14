import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission, requireAnyPermission } from "@/middlewares/permission.middleware";
import { sponsorService } from "@/services/sponsor.service";
import { uploadService } from "@/services/upload.service";
import {
  CreateSponsorSchema,
  UpdateSponsorSchema,
  SponsorQuerySchema,
  CreateLeadSchema,
  LeadQuerySchema,
  UploadUrlRequestSchema,
  type UploadUrlRequest,
} from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });
const ParamsWithSponsorId = z.object({ sponsorId: z.string() });

export const sponsorRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Add Sponsor to Event ─────────────────────────────────────────────
  fastify.post(
    "/:eventId/sponsors",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:manage_sponsors"),
        validate({ params: ParamsWithEventId, body: CreateSponsorSchema }),
      ],
      schema: {
        tags: ["Sponsors"],
        summary: "Add a sponsor to an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const dto = request.body as z.infer<typeof CreateSponsorSchema>;
      const sponsor = await sponsorService.createSponsor(dto, request.user!);
      return reply.status(201).send({ success: true, data: sponsor });
    },
  );

  // ─── List Event Sponsors ──────────────────────────────────────────────
  fastify.get(
    "/:eventId/sponsors",
    {
      preHandler: [validate({ params: ParamsWithEventId, query: SponsorQuerySchema })],
      schema: {
        tags: ["Sponsors"],
        summary: "List sponsors for an event (public)",
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { tier, page, limit } = request.query as z.infer<typeof SponsorQuerySchema>;
      const result = await sponsorService.listEventSponsors(
        eventId,
        { tier },
        { page: page ?? 1, limit: limit ?? 50 },
      );
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Get Sponsor Detail ───────────────────────────────────────────────
  fastify.get(
    "/sponsors/:sponsorId",
    {
      preHandler: [validate({ params: ParamsWithSponsorId })],
      schema: {
        tags: ["Sponsors"],
        summary: "Get sponsor detail (public)",
      },
    },
    async (request, reply) => {
      const { sponsorId } = request.params as z.infer<typeof ParamsWithSponsorId>;
      const sponsor = await sponsorService.getSponsor(sponsorId);
      return reply.send({ success: true, data: sponsor });
    },
  );

  // ─── Update Sponsor ───────────────────────────────────────────────────
  fastify.put(
    "/sponsors/:sponsorId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requireAnyPermission(["sponsor:manage_booth", "event:manage_sponsors"]),
        validate({ params: ParamsWithSponsorId, body: UpdateSponsorSchema }),
      ],
      schema: {
        tags: ["Sponsors"],
        summary: "Update sponsor profile / booth",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { sponsorId } = request.params as z.infer<typeof ParamsWithSponsorId>;
      const dto = request.body as z.infer<typeof UpdateSponsorSchema>;
      const sponsor = await sponsorService.updateSponsor(sponsorId, dto, request.user!);
      return reply.send({ success: true, data: sponsor });
    },
  );

  // ─── Delete Sponsor ───────────────────────────────────────────────────
  fastify.delete(
    "/sponsors/:sponsorId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:manage_sponsors"),
        validate({ params: ParamsWithSponsorId }),
      ],
      schema: {
        tags: ["Sponsors"],
        summary: "Remove sponsor from event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { sponsorId } = request.params as z.infer<typeof ParamsWithSponsorId>;
      await sponsorService.deleteSponsor(sponsorId, request.user!);
      return reply.send({ success: true });
    },
  );

  // ─── Upload URL for Sponsor Assets ────────────────────────────────────
  fastify.post(
    "/sponsors/:sponsorId/upload-url",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("sponsor:manage_booth"),
        validate({ params: ParamsWithSponsorId, body: UploadUrlRequestSchema }),
      ],
      schema: {
        tags: ["Sponsors"],
        summary: "Get a signed upload URL for sponsor logo or banner",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { sponsorId } = request.params as z.infer<typeof ParamsWithSponsorId>;
      const result = await uploadService.generateUploadUrl(
        "sponsor",
        sponsorId,
        request.body as UploadUrlRequest,
        request.user!,
      );
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Scan Lead ────────────────────────────────────────────────────────
  fastify.post(
    "/sponsors/:sponsorId/leads",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("sponsor:collect_leads"),
        validate({ params: ParamsWithSponsorId, body: CreateLeadSchema }),
      ],
      schema: {
        tags: ["Sponsors"],
        summary: "Scan participant badge to collect lead",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { sponsorId } = request.params as z.infer<typeof ParamsWithSponsorId>;
      const dto = request.body as z.infer<typeof CreateLeadSchema>;
      const lead = await sponsorService.scanLead(sponsorId, dto, request.user!);
      return reply.status(201).send({ success: true, data: lead });
    },
  );

  // ─── List Leads ───────────────────────────────────────────────────────
  fastify.get(
    "/sponsors/:sponsorId/leads",
    {
      preHandler: [
        authenticate,
        requirePermission("sponsor:view_leads"),
        validate({ params: ParamsWithSponsorId, query: LeadQuerySchema }),
      ],
      schema: {
        tags: ["Sponsors"],
        summary: "List collected leads for a sponsor",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { sponsorId } = request.params as z.infer<typeof ParamsWithSponsorId>;
      const { page, limit } = request.query as z.infer<typeof LeadQuerySchema>;
      const result = await sponsorService.listLeads(
        sponsorId,
        { page: page ?? 1, limit: limit ?? 50 },
        request.user!,
      );
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Export Leads ─────────────────────────────────────────────────────
  fastify.get(
    "/sponsors/:sponsorId/leads/export",
    {
      preHandler: [
        authenticate,
        requirePermission("sponsor:view_leads"),
        validate({ params: ParamsWithSponsorId }),
      ],
      schema: {
        tags: ["Sponsors"],
        summary: "Export all leads for a sponsor (JSON)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { sponsorId } = request.params as z.infer<typeof ParamsWithSponsorId>;
      const leads = await sponsorService.exportLeads(sponsorId, request.user!);
      return reply.send({ success: true, data: leads });
    },
  );
};
