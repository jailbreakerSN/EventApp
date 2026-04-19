import type { FastifyInstance } from "fastify";
import { authenticate, optionalAuth, requireEmailVerified } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { sessionService } from "@/services/session.service";
import {
  CreateSessionSchema,
  UpdateSessionSchema,
  SessionScheduleQuerySchema,
} from "@teranga/shared-types";
import { z } from "zod";

const EventIdParams = z.object({ eventId: z.string() });
const SessionIdParams = z.object({ eventId: z.string(), sessionId: z.string() });

export async function sessionRoutes(app: FastifyInstance) {
  // ─── List sessions for an event ─────────────────────────────────────────
  // Published agendas are PUBLIC — any visitor (authenticated or not) can
  // fetch the programme because the participant marketing site renders it
  // via SSR on the public event detail page. The service still gates draft/
  // unpublished agendas behind authentication + org access so unreleased
  // programmes never leak.
  app.get(
    "/:eventId/sessions",
    {
      preHandler: [
        optionalAuth,
        validate({ params: EventIdParams, query: SessionScheduleQuerySchema }),
      ],
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof EventIdParams>;
      const query = request.query as z.infer<typeof SessionScheduleQuerySchema>;
      const result = await sessionService.listByEvent(eventId, query, request.user);
      return reply.send({ success: true, ...result });
    },
  );

  // ─── Get single session ─────────────────────────────────────────────────
  app.get(
    "/:eventId/sessions/:sessionId",
    {
      preHandler: [optionalAuth, validate({ params: SessionIdParams })],
    },
    async (request, reply) => {
      const { eventId, sessionId } = request.params as z.infer<typeof SessionIdParams>;
      const session = await sessionService.getById(eventId, sessionId, request.user);
      return reply.send({ success: true, data: session });
    },
  );

  // ─── Create session ─────────────────────────────────────────────────────
  app.post(
    "/:eventId/sessions",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:create"),
        validate({ params: EventIdParams, body: CreateSessionSchema }),
      ],
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof EventIdParams>;
      const dto = request.body as z.infer<typeof CreateSessionSchema>;
      const session = await sessionService.create(eventId, dto, request.user!);
      return reply.status(201).send({ success: true, data: session });
    },
  );

  // ─── Update session ─────────────────────────────────────────────────────
  app.patch(
    "/:eventId/sessions/:sessionId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: SessionIdParams, body: UpdateSessionSchema }),
      ],
    },
    async (request, reply) => {
      const { eventId, sessionId } = request.params as z.infer<typeof SessionIdParams>;
      const dto = request.body as z.infer<typeof UpdateSessionSchema>;
      await sessionService.update(eventId, sessionId, dto, request.user!);
      return reply.send({ success: true });
    },
  );

  // ─── Delete session ─────────────────────────────────────────────────────
  app.delete(
    "/:eventId/sessions/:sessionId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("event:update"),
        validate({ params: SessionIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId, sessionId } = request.params as z.infer<typeof SessionIdParams>;
      await sessionService.delete(eventId, sessionId, request.user!);
      return reply.status(204).send();
    },
  );

  // ─── Bookmark a session ─────────────────────────────────────────────────
  // Bookmarks are per-user — any authenticated participant can manage their
  // own bookmarks on any session they can see. We intentionally don't gate
  // this behind `event:read` because participants don't hold that
  // permission (it's organizer-scoped) and the service re-checks org access
  // for non-published events.
  app.post(
    "/:eventId/sessions/:sessionId/bookmark",
    {
      preHandler: [authenticate, requireEmailVerified, validate({ params: SessionIdParams })],
    },
    async (request, reply) => {
      const { eventId, sessionId } = request.params as z.infer<typeof SessionIdParams>;
      const bookmark = await sessionService.bookmark(eventId, sessionId, request.user!);
      return reply.status(201).send({ success: true, data: bookmark });
    },
  );

  // ─── Remove bookmark ───────────────────────────────────────────────────
  app.delete(
    "/:eventId/sessions/:sessionId/bookmark",
    {
      preHandler: [authenticate, requireEmailVerified, validate({ params: SessionIdParams })],
    },
    async (request, reply) => {
      const { eventId, sessionId } = request.params as z.infer<typeof SessionIdParams>;
      await sessionService.removeBookmark(eventId, sessionId, request.user!);
      return reply.status(204).send();
    },
  );

  // ─── Get user's bookmarks for an event ──────────────────────────────────
  app.get(
    "/:eventId/sessions-bookmarks",
    {
      preHandler: [authenticate, validate({ params: EventIdParams })],
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof EventIdParams>;
      const bookmarks = await sessionService.getUserBookmarks(eventId, request.user!);
      return reply.send({ success: true, data: bookmarks });
    },
  );
}
