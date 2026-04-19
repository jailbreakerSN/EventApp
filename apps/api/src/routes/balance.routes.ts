import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { balanceService } from "@/services/balance.service";
import { BalanceTransactionQuerySchema } from "@teranga/shared-types";

// ─── Balance / Ledger Routes ─────────────────────────────────────────────────
//
// Exposes the org-level balance summary + paginated ledger for the /finance
// page. Mounted under /v1/organizations/:orgId to keep URL structure
// consistent with the existing subscription / usage endpoints.

const ParamsWithOrgId = z.object({ orgId: z.string() });

export const balanceRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Balance summary ───────────────────────────────────────────────────
  fastify.get(
    "/v1/organizations/:orgId/balance",
    {
      preHandler: [
        authenticate,
        requirePermission("payment:view_reports"),
        validate({ params: ParamsWithOrgId }),
      ],
      schema: {
        tags: ["Balance"],
        summary: "Get aggregated balance for an organization",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const balance = await balanceService.getBalance(orgId, request.user!);
      return reply.send({ success: true, data: balance });
    },
  );

  // ─── Paginated ledger transactions ─────────────────────────────────────
  fastify.get(
    "/v1/organizations/:orgId/balance-transactions",
    {
      preHandler: [
        authenticate,
        requirePermission("payment:view_reports"),
        validate({ params: ParamsWithOrgId, query: BalanceTransactionQuerySchema }),
      ],
      schema: {
        tags: ["Balance"],
        summary: "List balance-transactions (ledger entries) for an organization",
        security: [{ BearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as z.infer<typeof ParamsWithOrgId>;
      const query = request.query as z.infer<typeof BalanceTransactionQuerySchema>;
      const result = await balanceService.listTransactions(orgId, query, request.user!);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  );
};
