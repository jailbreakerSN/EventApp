/**
 * Organizer overhaul — Phase O7.
 *
 * Org-scoped participant ops: profile (tags + notes), bulk-tag from
 * registrations, duplicate detection + merge.
 *
 * All routes are mounted under `/v1/organizations/:orgId/participants`
 * to make the org-scope explicit in the URL — easier to reason about
 * Firestore rules + audit trails than a flat `/v1/participants`.
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { participantProfileService } from "@/services/participant-profile.service";
import { participantMergeService } from "@/services/participant-merge.service";
import {
  UpdateParticipantProfileSchema,
  BulkTagRegistrationsSchema,
  MergeParticipantsSchema,
} from "@teranga/shared-types";

const OrgIdParam = z.object({ orgId: z.string().min(1) });
const ProfileParams = z.object({ orgId: z.string().min(1), userId: z.string().min(1) });

export const participantRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Get one profile ──────────────────────────────────────────────────
  fastify.get(
    "/:userId/profile",
    {
      preHandler: [
        authenticate,
        requirePermission("registration:read_all"),
        validate({ params: ProfileParams }),
      ],
      schema: {
        tags: ["Participants"],
        summary: "Read the org-scoped participant profile (tags + notes)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId, userId } = request.params as z.infer<typeof ProfileParams>;
      const profile = await participantProfileService.get(request.user!, orgId, userId);
      return reply.send({ success: true, data: profile });
    },
  );

  // ─── Update one profile (tags + notes) ────────────────────────────────
  fastify.patch(
    "/:userId/profile",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("registration:read_all"),
        validate({ params: ProfileParams, body: UpdateParticipantProfileSchema }),
      ],
      schema: {
        tags: ["Participants"],
        summary: "Update tags and/or organizer notes for a participant",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId, userId } = request.params as z.infer<typeof ProfileParams>;
      const dto = request.body as z.infer<typeof UpdateParticipantProfileSchema>;
      const next = await participantProfileService.update(request.user!, orgId, userId, dto);
      return reply.send({ success: true, data: next });
    },
  );

  // ─── Bulk tag from a list of registrations ────────────────────────────
  fastify.post(
    "/bulk-tag",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("registration:read_all"),
        validate({ params: OrgIdParam, body: BulkTagRegistrationsSchema }),
      ],
      schema: {
        tags: ["Participants"],
        summary: "Bulk add/remove tags across many participants by registration id",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof OrgIdParam>;
      const dto = request.body as z.infer<typeof BulkTagRegistrationsSchema>;
      const result = await participantProfileService.bulkTagFromRegistrations(
        request.user!,
        orgId,
        dto,
      );
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Detect duplicate participants ────────────────────────────────────
  fastify.get(
    "/duplicates",
    {
      preHandler: [
        authenticate,
        requirePermission("registration:read_all"),
        validate({ params: OrgIdParam }),
      ],
      schema: {
        tags: ["Participants"],
        summary: "List candidate duplicate participant pairs (email/phone normalised)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof OrgIdParam>;
      const candidates = await participantMergeService.detectDuplicates(request.user!, orgId);
      return reply.send({ success: true, data: candidates });
    },
  );

  // ─── Merge two participants ───────────────────────────────────────────
  fastify.post(
    "/merge",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("registration:read_all"),
        validate({ params: OrgIdParam, body: MergeParticipantsSchema }),
      ],
      schema: {
        tags: ["Participants"],
        summary: "Merge a secondary participant into a primary one (atomic)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof OrgIdParam>;
      const dto = request.body as z.infer<typeof MergeParticipantsSchema>;
      const result = await participantMergeService.merge(
        request.user!,
        orgId,
        dto.primaryUserId,
        dto.secondaryUserId,
      );
      return reply.send({ success: true, data: result });
    },
  );
};
