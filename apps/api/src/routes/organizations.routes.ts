import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { organizationService } from "@/services/organization.service";
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
} from "@teranga/shared-types";

const ParamsWithOrgId = z.object({ orgId: z.string() });

const AddMemberBody = z.object({
  userId: z.string(),
});

const RemoveMemberBody = z.object({
  userId: z.string(),
});

export const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Create Organization ─────────────────────────────────────────────────
  fastify.post(
    "/",
    {
      preHandler: [authenticate, requirePermission("organization:create"), validate({ body: CreateOrganizationSchema })],
      schema: { tags: ["Organizations"], summary: "Create organization", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const org = await organizationService.create(request.body as any, request.user!);
      return reply.status(201).send({ success: true, data: org });
    },
  );

  // ─── Get Organization ────────────────────────────────────────────────────
  fastify.get(
    "/:orgId",
    {
      preHandler: [authenticate, requirePermission("organization:read"), validate({ params: ParamsWithOrgId })],
      schema: { tags: ["Organizations"], summary: "Get organization by ID", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const org = await organizationService.getById(orgId, request.user!);
      return reply.send({ success: true, data: org });
    },
  );

  // ─── Update Organization ─────────────────────────────────────────────────
  fastify.patch(
    "/:orgId",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:update"),
        validate({ params: ParamsWithOrgId, body: UpdateOrganizationSchema }),
      ],
      schema: { tags: ["Organizations"], summary: "Update organization", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      await organizationService.update(orgId, request.body as any, request.user!);
      return reply.send({ success: true, data: { id: orgId } });
    },
  );

  // ─── Add Member ──────────────────────────────────────────────────────────
  fastify.post(
    "/:orgId/members",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:manage_members"),
        validate({ params: ParamsWithOrgId, body: AddMemberBody }),
      ],
      schema: { tags: ["Organizations"], summary: "Add organization member", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const { userId } = request.body as z.infer<typeof AddMemberBody>;
      await organizationService.addMember(orgId, userId, request.user!);
      return reply.status(201).send({ success: true, data: { orgId, userId } });
    },
  );

  // ─── Remove Member ───────────────────────────────────────────────────────
  fastify.delete(
    "/:orgId/members",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:manage_members"),
        validate({ params: ParamsWithOrgId, body: RemoveMemberBody }),
      ],
      schema: { tags: ["Organizations"], summary: "Remove organization member", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const { userId } = request.body as z.infer<typeof RemoveMemberBody>;
      await organizationService.removeMember(orgId, userId, request.user!);
      return reply.status(204).send();
    },
  );
};
