import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateApiKeyRequestSchema,
  RevokeApiKeyRequestSchema,
  RotateApiKeyRequestSchema,
} from "@teranga/shared-types";
import { authenticate, requireEmailVerified } from "@/middlewares/auth.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { apiKeysService } from "@/services/api-keys.service";

/**
 * T2.3 — Organization-scoped API key routes.
 *
 * Permission model:
 *   - GET (list / detail):   `organization:read`
 *   - POST / PATCH / DELETE: `organization:manage_billing`
 *
 * Why `organization:manage_billing` for mutations: API keys are a
 * revenue-adjacent surface (enterprise-only feature) and we want the
 * issuance privilege to correlate with financial responsibility on the
 * org — same set of humans who can change the plan can issue keys.
 *
 * Rate limiting: the global per-user limiter in app.ts already covers
 * these endpoints. API-key-authenticated callers CANNOT reach these
 * routes — they're human-operator surfaces. A session authenticated
 * with `terk_*` would land here with `isApiKey: true` and the
 * permission check would fail (keys don't have
 * `organization:manage_billing` as a scope).
 */
export const apiKeysRoutes: FastifyPluginAsync = async (app) => {
  const OrgParams = z.object({ orgId: z.string().min(1) });
  const KeyParams = z.object({
    orgId: z.string().min(1),
    apiKeyId: z.string().min(1),
  });

  // ─── List ──────────────────────────────────────────────────────────────
  // Page/limit only — `apiKeysService.list` does NOT honour orderBy
  // (the repository hard-codes `(organizationId, createdAt DESC)`), so
  // accepting an open `orderBy: z.string().optional()` from the
  // inherited `PaginationSchema` was a silent surface-area leak. Same
  // class as the staging /v1/events/org 500 (PR #215).
  const ApiKeysListQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  });
  app.get<{
    Params: z.infer<typeof OrgParams>;
    Querystring: z.infer<typeof ApiKeysListQuerySchema>;
  }>(
    "/v1/organizations/:orgId/api-keys",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:read"),
        validate({ params: OrgParams, query: ApiKeysListQuerySchema }),
      ],
    },
    async (request, reply) => {
      const { page, limit } = request.query;
      const result = await apiKeysService.list(request.user!, request.params.orgId, {
        page,
        limit,
      });
      return reply.send({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    },
  );

  // ─── Detail ────────────────────────────────────────────────────────────
  app.get<{ Params: z.infer<typeof KeyParams> }>(
    "/v1/organizations/:orgId/api-keys/:apiKeyId",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:read"),
        validate({ params: KeyParams }),
      ],
    },
    async (request, reply) => {
      const row = await apiKeysService.get(
        request.user!,
        request.params.orgId,
        request.params.apiKeyId,
      );
      return reply.send({ success: true, data: row });
    },
  );

  // ─── Usage analytics (T2.3 closure) ────────────────────────────────────
  // 30-day daily request-volume bucket, derived from the `api_key.
  // verified` audit rows. Read-only; gated on `organization:read`.
  app.get<{ Params: z.infer<typeof KeyParams> }>(
    "/v1/organizations/:orgId/api-keys/:apiKeyId/usage",
    {
      preHandler: [
        authenticate,
        requirePermission("organization:read"),
        validate({ params: KeyParams }),
      ],
    },
    async (request, reply) => {
      const data = await apiKeysService.getUsageAnalytics(
        request.user!,
        request.params.orgId,
        request.params.apiKeyId,
      );
      return reply.send({ success: true, data });
    },
  );

  // ─── Issue ─────────────────────────────────────────────────────────────
  // Returns 201 with the plaintext key included in the response body.
  // The caller MUST store the plaintext now — subsequent GETs return
  // only the non-secret metadata.
  app.post<{
    Params: z.infer<typeof OrgParams>;
    Body: z.infer<typeof CreateApiKeyRequestSchema>;
  }>(
    "/v1/organizations/:orgId/api-keys",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("organization:manage_billing"),
        validate({ params: OrgParams, body: CreateApiKeyRequestSchema }),
      ],
    },
    async (request, reply) => {
      const result = await apiKeysService.issue(request.user!, request.params.orgId, request.body);
      return reply.status(201).send({
        success: true,
        data: {
          apiKey: { ...result.apiKey, keyHash: "" },
          plaintext: result.plaintext,
        },
      });
    },
  );

  // ─── Revoke ────────────────────────────────────────────────────────────
  app.post<{
    Params: z.infer<typeof KeyParams>;
    Body: z.infer<typeof RevokeApiKeyRequestSchema>;
  }>(
    "/v1/organizations/:orgId/api-keys/:apiKeyId/revoke",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("organization:manage_billing"),
        validate({ params: KeyParams, body: RevokeApiKeyRequestSchema }),
      ],
    },
    async (request, reply) => {
      const row = await apiKeysService.revoke(
        request.user!,
        request.params.orgId,
        request.params.apiKeyId,
        request.body.reason,
      );
      return reply.send({ success: true, data: row });
    },
  );

  // ─── Rotate ────────────────────────────────────────────────────────────
  // Atomic "revoke old + issue new" in one transaction. Use case: a key
  // leaked to a public repo; the operator pastes the leak response and
  // rotates in one click. Response carries the new plaintext (ONCE).
  app.post<{
    Params: z.infer<typeof KeyParams>;
    Body: z.infer<typeof RotateApiKeyRequestSchema>;
  }>(
    "/v1/organizations/:orgId/api-keys/:apiKeyId/rotate",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("organization:manage_billing"),
        validate({ params: KeyParams, body: RotateApiKeyRequestSchema }),
      ],
    },
    async (request, reply) => {
      const result = await apiKeysService.rotate(
        request.user!,
        request.params.orgId,
        request.params.apiKeyId,
        { name: request.body.name, reason: request.body.reason },
      );
      return reply.status(201).send({
        success: true,
        data: {
          newApiKey: { ...result.newApiKey, keyHash: "" },
          plaintext: result.plaintext,
          revokedApiKeyId: result.revokedApiKeyId,
        },
      });
    },
  );
};
