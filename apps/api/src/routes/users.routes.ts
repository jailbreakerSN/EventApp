import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { requirePermission } from "@/middlewares/permission.middleware";
import { userRepository } from "@/repositories/user.repository";
import { UpdateUserProfileSchema } from "@teranga/shared-types";

const ParamsWithUserId = z.object({ userId: z.string() });

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Get Current User Profile ────────────────────────────────────────────
  fastify.get(
    "/me",
    {
      preHandler: [authenticate],
      schema: { tags: ["Users"], summary: "Get current user profile", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const user = await userRepository.findOrCreateFromAuth(request.user!.uid);
      return reply.send({ success: true, data: user });
    },
  );

  // ─── Update Current User Profile ─────────────────────────────────────────
  fastify.patch(
    "/me",
    {
      preHandler: [authenticate, validate({ body: UpdateUserProfileSchema })],
      schema: { tags: ["Users"], summary: "Update current user profile", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const uid = request.user!.uid;
      await userRepository.update(uid, request.body as any);
      return reply.send({ success: true, data: { id: uid } });
    },
  );

  // ─── Register FCM Token ──────────────────────────────────────────────────
  fastify.post(
    "/me/fcm-token",
    {
      preHandler: [authenticate, validate({ body: z.object({ token: z.string().min(10) }) })],
      schema: { tags: ["Users"], summary: "Register FCM token", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { token } = request.body as { token: string };
      await userRepository.addFcmToken(request.user!.uid, token);
      return reply.send({ success: true, data: null });
    },
  );

  // ─── Get Public Profile ──────────────────────────────────────────────────
  fastify.get(
    "/:userId",
    {
      preHandler: [authenticate, requirePermission("profile:read_any"), validate({ params: ParamsWithUserId })],
      schema: { tags: ["Users"], summary: "Get user public profile", security: [{ BearerAuth: [] }] },
    },
    async (request, reply) => {
      const { userId } = request.params as z.infer<typeof ParamsWithUserId>;
      const user = await userRepository.findByIdOrThrow(userId);
      // Return only public fields
      const { displayName, photoURL, bio, roles } = user;
      return reply.send({ success: true, data: { id: userId, displayName, photoURL, bio, roles } });
    },
  );
};
