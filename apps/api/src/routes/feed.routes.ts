import type { FastifyInstance } from "fastify";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { feedService } from "@/services/feed.service";
import {
  CreateFeedPostSchema,
  CreateFeedCommentSchema,
  FeedQuerySchema,
} from "@teranga/shared-types";
import { z } from "zod";

const EventIdParams = z.object({ eventId: z.string() });
const PostIdParams = z.object({ eventId: z.string(), postId: z.string() });
const CommentIdParams = z.object({ eventId: z.string(), postId: z.string(), commentId: z.string() });

export async function feedRoutes(app: FastifyInstance) {
  // ─── List feed posts ────────────────────────────────────────────────────
  app.get(
    "/:eventId/feed",
    {
      preHandler: [
        authenticate,
        validate({ params: EventIdParams, query: FeedQuerySchema }),
      ],
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof EventIdParams>;
      const query = request.query as z.infer<typeof FeedQuerySchema>;
      const result = await feedService.listPosts(eventId, query, request.user!);
      return reply.send({ success: true, ...result });
    },
  );

  // ─── Create feed post ──────────────────────────────────────────────────
  app.post(
    "/:eventId/feed",
    {
      preHandler: [
        authenticate,
        validate({ params: EventIdParams, body: CreateFeedPostSchema }),
      ],
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof EventIdParams>;
      const dto = request.body as z.infer<typeof CreateFeedPostSchema>;
      const post = await feedService.createPost(eventId, dto, request.user!);
      return reply.status(201).send({ success: true, data: post });
    },
  );

  // ─── Toggle like ───────────────────────────────────────────────────────
  app.post(
    "/:eventId/feed/:postId/like",
    {
      preHandler: [
        authenticate,
        validate({ params: PostIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId, postId } = request.params as z.infer<typeof PostIdParams>;
      const result = await feedService.toggleLike(eventId, postId, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Toggle pin ────────────────────────────────────────────────────────
  app.post(
    "/:eventId/feed/:postId/pin",
    {
      preHandler: [
        authenticate,
        validate({ params: PostIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId, postId } = request.params as z.infer<typeof PostIdParams>;
      const result = await feedService.togglePin(eventId, postId, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Delete post ───────────────────────────────────────────────────────
  app.delete(
    "/:eventId/feed/:postId",
    {
      preHandler: [
        authenticate,
        validate({ params: PostIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId, postId } = request.params as z.infer<typeof PostIdParams>;
      await feedService.deletePost(eventId, postId, request.user!);
      return reply.status(204).send();
    },
  );

  // ─── List comments ─────────────────────────────────────────────────────
  app.get(
    "/:eventId/feed/:postId/comments",
    {
      preHandler: [
        authenticate,
        validate({ params: PostIdParams, query: FeedQuerySchema }),
      ],
    },
    async (request, reply) => {
      const { eventId, postId } = request.params as z.infer<typeof PostIdParams>;
      const query = request.query as z.infer<typeof FeedQuerySchema>;
      const result = await feedService.listComments(eventId, postId, query, request.user!);
      return reply.send({ success: true, ...result });
    },
  );

  // ─── Add comment ───────────────────────────────────────────────────────
  app.post(
    "/:eventId/feed/:postId/comments",
    {
      preHandler: [
        authenticate,
        validate({ params: PostIdParams, body: CreateFeedCommentSchema }),
      ],
    },
    async (request, reply) => {
      const { eventId, postId } = request.params as z.infer<typeof PostIdParams>;
      const dto = request.body as z.infer<typeof CreateFeedCommentSchema>;
      const comment = await feedService.addComment(eventId, postId, dto, request.user!);
      return reply.status(201).send({ success: true, data: comment });
    },
  );

  // ─── Delete comment ────────────────────────────────────────────────────
  app.delete(
    "/:eventId/feed/:postId/comments/:commentId",
    {
      preHandler: [
        authenticate,
        validate({ params: CommentIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId, postId, commentId } = request.params as z.infer<typeof CommentIdParams>;
      await feedService.deleteComment(eventId, postId, commentId, request.user!);
      return reply.status(204).send();
    },
  );
}
