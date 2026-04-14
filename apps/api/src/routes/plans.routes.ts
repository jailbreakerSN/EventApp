import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { planService } from "@/services/plan.service";
import { CreatePlanSchema, UpdatePlanSchema } from "@teranga/shared-types";

const ParamsWithPlanId = z.object({ planId: z.string() });
const ParamsWithKey = z.object({ key: z.string() });
const AdminListQuery = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

/**
 * Public plan catalog routes.
 *
 * Mounted at `/v1/plans` — read-only to authenticated users. Returns only
 * public, non-archived plans.
 */
export const planRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Plans"],
        summary: "List the public plan catalog",
        security: [{ BearerAuth: [] }],
      },
    },
    async (_request, reply) => {
      const plans = await planService.getPublicCatalog();
      return reply.send({ success: true, data: plans });
    },
  );

  fastify.get(
    "/:key",
    {
      preHandler: [authenticate, validate({ params: ParamsWithKey })],
      schema: {
        tags: ["Plans"],
        summary: "Get a single public plan by key",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { key } = request.params as z.infer<typeof ParamsWithKey>;
      const plan = await planService.getByKey(key);
      return reply.send({ success: true, data: plan });
    },
  );
};

/**
 * Admin plan catalog routes.
 *
 * Mounted at `/v1/admin/plans` — superadmin-only (plan:manage).
 */
export const adminPlanRoutes: FastifyPluginAsync = async (fastify) => {
  const preHandler = [authenticate, requirePermission("plan:manage")];

  fastify.get(
    "/",
    {
      preHandler: [...preHandler, validate({ query: AdminListQuery })],
      schema: {
        tags: ["Admin", "Plans"],
        summary: "List all plans (includes archived, private)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { includeArchived } = request.query as z.infer<typeof AdminListQuery>;
      const plans = await planService.listAll(request.user!, {
        includeArchived: includeArchived ?? true,
      });
      return reply.send({ success: true, data: plans });
    },
  );

  fastify.get(
    "/:planId",
    {
      preHandler: [...preHandler, validate({ params: ParamsWithPlanId })],
      schema: {
        tags: ["Admin", "Plans"],
        summary: "Get a plan by ID",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { planId } = request.params as z.infer<typeof ParamsWithPlanId>;
      const plan = await planService.getById(planId, request.user!);
      return reply.send({ success: true, data: plan });
    },
  );

  fastify.post(
    "/",
    {
      preHandler: [...preHandler, validate({ body: CreatePlanSchema })],
      schema: {
        tags: ["Admin", "Plans"],
        summary: "Create a custom plan",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const plan = await planService.create(
        request.body as z.infer<typeof CreatePlanSchema>,
        request.user!,
      );
      return reply.status(201).send({ success: true, data: plan });
    },
  );

  fastify.patch(
    "/:planId",
    {
      preHandler: [...preHandler, validate({ params: ParamsWithPlanId, body: UpdatePlanSchema })],
      schema: {
        tags: ["Admin", "Plans"],
        summary: "Update a plan",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { planId } = request.params as z.infer<typeof ParamsWithPlanId>;
      const plan = await planService.update(
        planId,
        request.body as z.infer<typeof UpdatePlanSchema>,
        request.user!,
      );
      return reply.send({ success: true, data: plan });
    },
  );

  fastify.delete(
    "/:planId",
    {
      preHandler: [...preHandler, validate({ params: ParamsWithPlanId })],
      schema: {
        tags: ["Admin", "Plans"],
        summary: "Archive a plan (soft-delete)",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { planId } = request.params as z.infer<typeof ParamsWithPlanId>;
      await planService.archive(planId, request.user!);
      return reply.status(204).send();
    },
  );
};
