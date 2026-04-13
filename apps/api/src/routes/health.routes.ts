import type { FastifyInstance } from "fastify";
import { db } from "@/config/firebase";

// ─── Health & Readiness Probes ──────────────────────────────────────────────
// /health  — lightweight liveness check (Cloud Run, k8s liveness probe)
// /ready   — deep readiness check with Firestore connectivity (k8s readiness probe)

export async function healthRoutes(app: FastifyInstance) {
  // Liveness: is the process running and accepting connections?
  app.get("/health", async () => ({
    status: "ok",
    version: "0.1.0",
    uptime: Math.floor(process.uptime()),
  }));

  // Readiness: can the service actually handle requests?
  // Verifies Firestore connectivity with a lightweight operation.
  //
  // Uses `db.listCollections()` (limited to 1) instead of reading from a
  // specific collection. Benefits:
  //   1. Doesn't require any particular collection to exist.
  //   2. Doesn't touch a reserved name. An earlier version queried a
  //      collection called `__healthcheck__`, which Firestore rejects with
  //      INVALID_ARGUMENT because identifiers starting with `__` are
  //      reserved. See https://firebase.google.com/docs/firestore/reference/naming
  //   3. No composite-index requirement — uses the root-level API.
  app.get("/ready", async (_request, reply) => {
    try {
      const start = Date.now();
      await db.listCollections();
      const latencyMs = Date.now() - start;

      return {
        status: "ready",
        version: "0.1.0",
        uptime: Math.floor(process.uptime()),
        checks: {
          firestore: { status: "ok", latencyMs },
        },
      };
    } catch (err) {
      reply.status(503);
      return {
        status: "not_ready",
        checks: {
          firestore: {
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          },
        },
      };
    }
  });
}
