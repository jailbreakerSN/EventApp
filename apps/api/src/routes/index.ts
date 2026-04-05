import type { FastifyInstance } from "fastify";
import { eventRoutes } from "./events.routes";
import { registrationRoutes } from "./registrations.routes";
import { badgeRoutes } from "./badges.routes";
import { userRoutes } from "./users.routes";
import { organizationRoutes } from "./organizations.routes";
import { healthRoutes } from "./health.routes";

export async function registerRoutes(app: FastifyInstance) {
  // ── Health & Readiness (no auth, no rate limit) ──────────────────────────
  await app.register(healthRoutes);

  // ── API v1 ───────────────────────────────────────────────────────────────
  await app.register(eventRoutes, { prefix: "/v1/events" });
  await app.register(registrationRoutes, { prefix: "/v1/registrations" });
  await app.register(badgeRoutes, { prefix: "/v1/badges" });
  await app.register(userRoutes, { prefix: "/v1/users" });
  await app.register(organizationRoutes, { prefix: "/v1/organizations" });
}
