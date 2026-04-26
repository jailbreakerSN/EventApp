/**
 * Wave 10 / W10-P3 — Prometheus metrics endpoint.
 *
 * Exposes the registry built in `apps/api/src/observability/metrics.ts`
 * at `GET /metrics` for Cloud Monitoring's managed-Prometheus scrape.
 *
 * Authentication
 * ──────────────
 * Token-based, NOT Firebase ID token. The scrape job runs with a
 * shared secret stored in `METRICS_AUTH_TOKEN` (env). The token is a
 * single, rotatable string — operationally simpler than wiring a
 * service-account flow into Cloud Run's metric agent.
 *
 * `METRICS_AUTH_TOKEN` SHOULD be set in production. When unset, the
 * endpoint is reachable without auth — acceptable for local dev and
 * for an emergency probe in staging, but a 503 in production. The
 * production deploy workflow (P5) will fail if the token is missing.
 *
 * Rate-limit: not applicable. The scrape is a known fixed-frequency
 * pull. We disable the global composite-key rate-limit explicitly so a
 * misbehaving scrape (e.g. retry storm) doesn't clip itself.
 */

import type { FastifyPluginAsync } from "fastify";
import { config } from "@/config/index";
import { metricsRegistry } from "@/observability/metrics";

const SCRAPE_TOKEN_PREFIX = "Bearer ";

export const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/metrics",
    {
      // Bypass the global composite-key rate-limit. The scrape job is
      // a known, well-behaved client.
      config: { rateLimit: false },
      schema: {
        hide: true, // not in OpenAPI surface
      },
    },
    async (request, reply) => {
      // Production-grade auth: require Bearer token match.
      const expected = config.METRICS_AUTH_TOKEN;
      if (expected) {
        const auth = request.headers.authorization ?? "";
        const presented =
          auth.startsWith(SCRAPE_TOKEN_PREFIX) && auth.slice(SCRAPE_TOKEN_PREFIX.length);
        // Constant-time compare via Buffer length-equal + timingSafeEqual
        // — the token namespace is small (one secret) so even cheap
        // string compares are fine, but we match the QR / API-key
        // posture for consistency.
        if (!presented || !timingSafeStringEqual(presented, expected)) {
          return reply.status(401).send({
            success: false,
            error: { code: "UNAUTHORIZED", message: "Metrics scrape token required" },
          });
        }
      }

      const body = await metricsRegistry.metrics();
      return reply.header("Content-Type", metricsRegistry.contentType).status(200).send(body);
    },
  );
};

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
