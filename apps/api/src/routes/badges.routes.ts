import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { badgeService } from "@/services/badge.service";
import { BadgeGenerateRequestSchema, BulkBadgeGenerateRequestSchema } from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });
const ParamsWithBadgeId = z.object({ badgeId: z.string() });

export const badgeRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Generate Badge ──────────────────────────────────────────────────────
  fastify.post(
    "/generate",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("badge:generate"),
        validate({ body: BadgeGenerateRequestSchema }),
      ],
      schema: {
        tags: ["Badges"],
        summary: "Generate badge for a registration",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof BadgeGenerateRequestSchema>;
      const badge = await badgeService.generate(
        body.registrationId,
        body.templateId ?? "",
        request.user!,
      );
      return reply.status(202).send({ success: true, data: badge });
    },
  );

  // ─── Bulk Generate Badges ────────────────────────────────────────────────
  fastify.post(
    "/bulk-generate",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("badge:bulk_generate"),
        validate({ body: BulkBadgeGenerateRequestSchema }),
      ],
      schema: {
        tags: ["Badges"],
        summary: "Bulk generate badges for an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof BulkBadgeGenerateRequestSchema>;
      const result = await badgeService.bulkGenerate(
        body.eventId,
        body.templateId ?? "",
        request.user!,
      );
      return reply.status(202).send({ success: true, data: result });
    },
  );

  // ─── Get My Badge ────────────────────────────────────────────────────────
  fastify.get(
    "/me/:eventId",
    {
      preHandler: [authenticate, validate({ params: ParamsWithEventId })],
      schema: {
        tags: ["Badges"],
        summary: "Get my badge for an event",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const badge = await badgeService.getMyBadge(eventId, request.user!);
      return reply.send({ success: true, data: badge });
    },
  );

  // ─── Download Badge PDF ──────────────────────────────────────────────────
  fastify.get(
    "/:badgeId/download",
    {
      preHandler: [authenticate, validate({ params: ParamsWithBadgeId })],
      schema: {
        tags: ["Badges"],
        summary: "Get a download URL for a badge PDF",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { badgeId } = request.params as z.infer<typeof ParamsWithBadgeId>;
      const result = await badgeService.download(badgeId, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Offline Sync Data (Staff) ───────────────────────────────────────────
  fastify.get(
    "/offline-sync/:eventId",
    {
      preHandler: [
        authenticate,
        requirePermission("checkin:sync_offline"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["Badges"],
        summary: "Download offline QR data for staff",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const data = await badgeService.getOfflineSyncData(eventId, request.user!);
      return reply.send({ success: true, data });
    },
  );
};
