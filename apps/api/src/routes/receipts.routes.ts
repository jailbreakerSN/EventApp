import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { receiptService } from "@/services/receipt.service";

const ParamsWithPaymentId = z.object({ paymentId: z.string() });
const ParamsWithReceiptId = z.object({ receiptId: z.string() });
const PaginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const receiptRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Generate Receipt ───────────────────────────────────────────────────
  fastify.post(
    "/:paymentId/generate",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("payment:read_own"),
        validate({ params: ParamsWithPaymentId }),
      ],
      schema: {
        tags: ["Receipts"],
        summary: "Generate a receipt for a succeeded payment",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { paymentId } = request.params as z.infer<typeof ParamsWithPaymentId>;
      const receipt = await receiptService.generateReceipt(paymentId, request.user!);
      return reply.status(201).send({ success: true, data: receipt });
    },
  );

  // ─── Get Receipt ────────────────────────────────────────────────────────
  fastify.get(
    "/:receiptId",
    {
      preHandler: [
        authenticate,
        requirePermission("payment:read_own"),
        validate({ params: ParamsWithReceiptId }),
      ],
      schema: {
        tags: ["Receipts"],
        summary: "Get a receipt by ID",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { receiptId } = request.params as z.infer<typeof ParamsWithReceiptId>;
      const receipt = await receiptService.getReceipt(receiptId, request.user!);
      return reply.send({ success: true, data: receipt });
    },
  );

  // ─── My Receipts ────────────────────────────────────────────────────────
  fastify.get(
    "/my",
    {
      preHandler: [
        authenticate,
        requirePermission("payment:read_own"),
        validate({ query: PaginationQuery }),
      ],
      schema: {
        tags: ["Receipts"],
        summary: "List my receipts",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { page, limit } = request.query as z.infer<typeof PaginationQuery>;
      const result = await receiptService.listMyReceipts(request.user!, { page, limit });
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );
};
