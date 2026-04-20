import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { checkinService } from "@/services/checkin.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { sealOfflineSyncPayload } from "@/services/offline-sync-crypto";
import { ValidationError } from "@/errors/app-error";
import {
  BulkCheckinRequestSchema,
  CheckinHistoryQuerySchema,
  OfflineSyncQuerySchema,
  type BulkCheckinRequest,
  type CheckinHistoryQuery,
  type OfflineSyncQuery,
} from "@teranga/shared-types";

const ParamsWithEventId = z.object({ eventId: z.string() });

export const checkinRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Offline Sync Data ─────────────────────────────────────────────────────
  // Returns the plaintext payload by default. Clients that support the
  // encrypted envelope opt in by passing `?encrypted=v1&clientPublicKey=<b64url>`;
  // older scanner builds keep getting the plaintext shape unchanged.
  // Every successful call — encrypted or not — emits an audit event so
  // post-event forensics can reconstruct who pulled what and when.
  fastify.get(
    "/:eventId/sync",
    {
      preHandler: [
        authenticate,
        validate({ params: ParamsWithEventId, query: OfflineSyncQuerySchema }),
        requirePermission("checkin:sync_offline"),
      ],
      schema: { tags: ["Check-in"], summary: "Get offline sync data for event" },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const query = request.query as OfflineSyncQuery;
      const data = await checkinService.getOfflineSyncData(eventId, request.user!);

      const wantsEncryption = query.encrypted === "v1";
      if (wantsEncryption && !query.clientPublicKey) {
        throw new ValidationError(
          "clientPublicKey is required when requesting the encrypted envelope",
        );
      }

      const auditAt = new Date().toISOString();
      eventBus.emit("checkin.offline_sync.downloaded", {
        eventId,
        organizationId: data.organizationId,
        staffId: request.user!.uid,
        scannerDeviceId: query.scannerDeviceId ?? null,
        encrypted: wantsEncryption,
        itemCount: data.totalRegistrations,
        ttlAt: data.ttlAt,
        actorId: request.user!.uid,
        requestId: getRequestId(),
        timestamp: auditAt,
      });

      if (wantsEncryption) {
        // aad = eventId so a ciphertext leaked from event A cannot be
        // replayed as event B's payload — GCM will tag-fail on open.
        const envelope = sealOfflineSyncPayload(data, query.clientPublicKey!, eventId);
        return reply.send({
          success: true,
          data: {
            ...envelope,
            eventId,
            syncedAt: data.syncedAt,
            ttlAt: data.ttlAt,
          },
        });
      }

      return reply.send({ success: true, data });
    },
  );

  // ─── Bulk Check-in Sync ────────────────────────────────────────────────────
  fastify.post(
    "/:eventId/checkin/sync",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        validate({ params: ParamsWithEventId, body: BulkCheckinRequestSchema }),
        requirePermission("checkin:scan"),
      ],
      schema: { tags: ["Check-in"], summary: "Sync offline check-ins" },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const { items } = request.body as BulkCheckinRequest;
      const result = await checkinService.bulkSync(eventId, items, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Check-in History ──────────────────────────────────────────────────────
  fastify.get(
    "/:eventId/checkin/history",
    {
      preHandler: [
        authenticate,
        validate({ params: ParamsWithEventId, query: CheckinHistoryQuerySchema }),
        requirePermission("checkin:view_log"),
      ],
      schema: {
        tags: ["Check-in"],
        summary: "Get paginated check-in history",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const query = request.query as CheckinHistoryQuery;
      const result = await checkinService.getHistory(eventId, query, request.user!);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Check-in Statistics ───────────────────────────────────────────────────
  fastify.get(
    "/:eventId/checkin/stats",
    {
      preHandler: [
        authenticate,
        validate({ params: ParamsWithEventId }),
        requirePermission("checkin:view_log"),
      ],
      schema: { tags: ["Check-in"], summary: "Get check-in statistics" },
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof ParamsWithEventId>;
      const stats = await checkinService.getStats(eventId, request.user!);
      return reply.send({ success: true, data: stats });
    },
  );
};
