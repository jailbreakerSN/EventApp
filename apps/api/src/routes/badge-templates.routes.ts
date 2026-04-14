import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { badgeTemplateService } from "@/services/badge-template.service";
import {
  CreateBadgeTemplateSchema,
  UpdateBadgeTemplateSchema,
  PaginationSchema,
} from "@teranga/shared-types";

const ParamsWithTemplateId = z.object({ templateId: z.string() });
const ListQuery = z.object({
  organizationId: z.string(),
  ...PaginationSchema.shape,
});

export const badgeTemplateRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Create Badge Template ──────────────────────────────────────────────
  fastify.post(
    "/",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("badge:generate"),
        validate({ body: CreateBadgeTemplateSchema }),
      ],
      schema: {
        tags: ["Badge Templates"],
        summary: "Create a badge template",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const template = await badgeTemplateService.create(
        request.body as z.infer<typeof CreateBadgeTemplateSchema>,
        request.user!,
      );
      return reply.status(201).send({ success: true, data: template });
    },
  );

  // ─── List Badge Templates by Organization ───────────────────────────────
  fastify.get(
    "/",
    {
      preHandler: [authenticate, validate({ query: ListQuery })],
      schema: {
        tags: ["Badge Templates"],
        summary: "List badge templates for an organization",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { organizationId, page, limit, orderBy, orderDir } = request.query as z.infer<
        typeof ListQuery
      >;
      const result = await badgeTemplateService.listByOrganization(organizationId, request.user!, {
        page,
        limit,
        orderBy,
        orderDir,
      });
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );

  // ─── Get Badge Template by ID ───────────────────────────────────────────
  fastify.get(
    "/:templateId",
    {
      preHandler: [authenticate, validate({ params: ParamsWithTemplateId })],
      schema: {
        tags: ["Badge Templates"],
        summary: "Get a badge template",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { templateId } = request.params as z.infer<typeof ParamsWithTemplateId>;
      const template = await badgeTemplateService.getById(templateId, request.user!);
      return reply.send({ success: true, data: template });
    },
  );

  // ─── Update Badge Template ──────────────────────────────────────────────
  fastify.patch(
    "/:templateId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("badge:generate"),
        validate({ params: ParamsWithTemplateId, body: UpdateBadgeTemplateSchema }),
      ],
      schema: {
        tags: ["Badge Templates"],
        summary: "Update a badge template",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { templateId } = request.params as z.infer<typeof ParamsWithTemplateId>;
      await badgeTemplateService.update(
        templateId,
        request.body as z.infer<typeof UpdateBadgeTemplateSchema>,
        request.user!,
      );
      return reply.send({ success: true, data: { id: templateId } });
    },
  );

  // ─── Delete (archive) Badge Template ────────────────────────────────────
  fastify.delete(
    "/:templateId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("badge:generate"),
        validate({ params: ParamsWithTemplateId }),
      ],
      schema: {
        tags: ["Badge Templates"],
        summary: "Archive a badge template",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { templateId } = request.params as z.infer<typeof ParamsWithTemplateId>;
      await badgeTemplateService.remove(templateId, request.user!);
      return reply.status(204).send();
    },
  );
};
