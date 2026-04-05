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
  // Verifies Firestore connectivity with a lightweight read.
  app.get("/ready", async (_request, reply) => {
    try {
      // Attempt a cheap Firestore operation (list 1 doc from root collection)
      const start = Date.now();
      await db.collection("__healthcheck__").limit(1).get();
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
