import type { FastifyInstance } from "fastify";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { feedService } from "@/services/feed.service";
import { uploadService } from "@/services/upload.service";
import {
  CreateFeedPostSchema,
  CreateFeedCommentSchema,
  FeedQuerySchema,
  UploadUrlRequestSchema,
} from "@teranga/shared-types";
import { z } from "zod";

const EventIdParams = z.object({ eventId: z.string() });
const PostIdParams = z.object({ eventId: z.string(), postId: z.string() });
const CommentIdParams = z.object({
  eventId: z.string(),
  postId: z.string(),
  commentId: z.string(),
});

export async function feedRoutes(app: FastifyInstance) {
  // ─── Upload URL for feed images (must be registered before generic POST) ──
  app.post(
    "/:eventId/feed/upload-url",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("feed:create_post"),
        validate({ params: EventIdParams, body: UploadUrlRequestSchema }),
      ],
    },
    async (request, reply) => {
      const { eventId } = request.params as z.infer<typeof EventIdParams>;
      const dto = request.body as z.infer<typeof UploadUrlRequestSchema>;
      const result = await uploadService.generateUploadUrl("feed", eventId, dto, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── List feed posts ────────────────────────────────────────────────────
  app.get(
    "/:eventId/feed",
    {
      preHandler: [
        authenticate,
        requirePermission("feed:read"),
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
        requireEmailVerified,
        requirePermission("feed:create_post"),
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
        requireEmailVerified,
        requirePermission("feed:read"),
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
        requireEmailVerified,
        requirePermission("feed:moderate"),
        validate({ params: PostIdParams }),
      ],
    },
    async (request, reply) => {
      const { eventId, postId } = request.params as z.infer<typeof PostIdParams>;
      const result = await feedService.togglePin(eventId, postId, request.user!);
      return reply.send({ success: true, data: result });
    },
  );

  // ─── Update post (author only) ──────────────────────────────────────────
  app.patch(
    "/:eventId/feed/:postId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("feed:create_post"),
        validate({
          params: PostIdParams,
          body: z.object({ content: z.string().min(1).max(2000) }),
        }),
      ],
    },
    async (request, reply) => {
      const { eventId, postId } = request.params as z.infer<typeof PostIdParams>;
      const { content } = request.body as { content: string };
      const post = await feedService.updatePost(eventId, postId, content, request.user!);
      return reply.send({ success: true, data: post });
    },
  );

  // ─── Delete post (author or moderator) ────────────────────────────────
  app.delete(
    "/:eventId/feed/:postId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("feed:create_post"),
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
        requirePermission("feed:read"),
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
        requireEmailVerified,
        requirePermission("feed:create_post"),
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

  // ─── Delete comment (author or moderator) ───────────────────────────────
  app.delete(
    "/:eventId/feed/:postId/comments/:commentId",
    {
      preHandler: [
        authenticate,
        requireEmailVerified,
        requirePermission("feed:create_post"),
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
