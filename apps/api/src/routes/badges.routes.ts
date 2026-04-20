import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { badgeService } from "@/services/badge.service";
import { eventRepository } from "@/repositories/event.repository";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
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

  // ─── Get My Badge (metadata) ─────────────────────────────────────────────
  fastify.get(
    "/me/:eventId",
    {
      preHandler: [
        authenticate,
        requirePermission("badge:view_own"),
        validate({ params: ParamsWithEventId }),
      ],
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

  // ─── Stream My Badge PDF ─────────────────────────────────────────────────
  // Renders the PDF on demand and streams the bytes back. Avoids Cloud
  // Storage signed URLs, which require `iam.signBlob` on the Cloud Run
  // runtime SA — that permission is not granted by default and was the root
  // cause of the production 500 on /v1/badges/me/:eventId.
  fastify.get(
    "/me/:eventId/pdf",
    {
      preHandler: [
        authenticate,
        requirePermission("badge:view_own"),
        validate({ params: ParamsWithEventId }),
      ],
      schema: {
        tags: ["Badges"],
        summary: "Download my badge PDF (binary)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { buffer, filename } = await badgeService.getMyBadgePdf(eventId, request.user!);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${filename}"`)
        .header("Cache-Control", "private, no-store")
        .send(buffer);
    },
  );

  // ─── Download Badge PDF (organizer/staff) ────────────────────────────────
  fastify.get(
    "/:badgeId/download",
    {
      preHandler: [
        authenticate,
        requirePermission("badge:view_own"),
        validate({ params: ParamsWithBadgeId }),
      ],
      schema: {
        tags: ["Badges"],
        summary: "Download a badge PDF (binary)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { badgeId } = request.params as z.infer<typeof ParamsWithBadgeId>;
      const { buffer, filename } = await badgeService.download(badgeId, request.user!);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("Cache-Control", "private, no-store")
        .send(buffer);
    },
  );

  // ─── Offline Sync Data (Staff) ───────────────────────────────────────────
  // Legacy alias — kept for existing Flutter builds. Prefer
  // `GET /v1/checkin/:eventId/sync` for new work (supports the encrypted
  // envelope + query-param audit fields). This route still emits the
  // `checkin.offline_sync.downloaded` audit event so the forensics trail
  // covers both shapes.
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
      // One extra read to resolve `organizationId` for the audit event.
      // This route is being deprecated; not worth denormalising the
      // service return shape just to avoid the trip.
      const event = await eventRepository.findByIdOrThrow(eventId);
      eventBus.emit("checkin.offline_sync.downloaded", {
        eventId,
        organizationId: event.organizationId,
        staffId: request.user!.uid,
        scannerDeviceId: null,
        encrypted: false,
        itemCount: data.registrations.length,
        ttlAt: data.ttlAt ?? data.downloadedAt,
        actorId: request.user!.uid,
        requestId: getRequestId(),
        timestamp: new Date().toISOString(),
      });
      return reply.send({ success: true, data });
    },
  );
};
