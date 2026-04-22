import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import { config } from "@/config";
import { validate } from "@/middlewares/validate.middleware";
import { notificationDispatcher } from "@/services/notification-dispatcher.service";
import {
  NotificationLocaleSchema,
  isKnownNotificationKey,
  type NotificationRecipient,
} from "@teranga/shared-types";

// ─── Internal Dispatch Endpoint (Phase 2.3) ────────────────────────────────
//
// Exposes a single HTTPS surface for Cloud Functions (and any other
// trusted server-side caller) to drop notifications into the regular
// dispatcher pipeline. Without this, scheduled jobs in
// `apps/functions/src/triggers/` could only deliver notifications by
// either:
//   (a) duplicating the react-email + Resend adapter stack inside the
//       Functions codebase (massively increases bundle size and splits
//       the template registry into two sources of truth), or
//   (b) writing directly to Firestore notification docs (bypasses admin
//       kill-switches + user opt-out + audit trail — the whole point of
//       the dispatcher).
//
// Instead, every scheduled job POSTs a catalog key + recipients + params
// here, and the API runs the dispatch exactly as if a domain-event
// listener had called `notificationDispatcher.dispatch(...)` directly.
//
// ── Authentication ────────────────────────────────────────────────────
//
// Requests MUST carry `X-Internal-Dispatch-Secret: <env INTERNAL_DISPATCH_SECRET>`.
// The shared secret is compared with `crypto.timingSafeEqual` to prevent
// timing-oracle attacks. On mismatch the route returns a 404 (not 401 or
// 403) so an unauthenticated probe cannot discover whether the endpoint
// exists — matches the posture of the other internal-only routes.
//
// Defense-in-depth: the endpoint is intended to be reachable ONLY from
// GCP egress (Cloud Run's internal networking / IAM-locked invokers). The
// shared secret is a second layer behind that network posture so a
// misconfigured VPC doesn't leak the surface.
//
// ── Rate limiting ─────────────────────────────────────────────────────
//
// Applied via Fastify's plugin-level rate limit config below. Scheduled
// jobs chunk their fanout into batches of <=500 recipients per request,
// so 120 req/minute is plenty for the cron cadence (15-min event
// reminders + daily subscription reminders). The cap prevents a stolen
// secret from being used as a blast amplifier.

const InternalDispatchRecipient = z.object({
  userId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  fcmTokens: z.array(z.string()).optional(),
  preferredLocale: NotificationLocaleSchema.default("fr"),
});

const InternalDispatchBody = z.object({
  key: z.string().min(1).refine(isKnownNotificationKey, {
    message: "Unknown notification catalog key",
  }),
  recipients: z.array(InternalDispatchRecipient).min(1).max(500),
  // Free-form key/value bag — each catalog entry declares its own shape.
  // We don't validate against the template params at the route layer
  // because the dispatcher/adapter is already tolerant of missing keys
  // (renders "undefined" into the template rather than throwing), and
  // mirroring 25+ param shapes at the route boundary would be redundant.
  params: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(1).max(256).optional(),
});

type InternalDispatchBody = z.infer<typeof InternalDispatchBody>;

function timingSafeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // timingSafeEqual requires equal lengths; compare against a
    // same-length dummy so the caller can't distinguish short-token
    // mismatch from wrong-value mismatch via latency.
    crypto.timingSafeEqual(aBuf, Buffer.alloc(aBuf.length));
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export const internalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/notifications/dispatch",
    {
      config: {
        // Aggressive cap — intended for scheduled jobs only. Chunked
        // fanout at 500 recipients/request means ~60k notifications
        // per minute is plenty of headroom for every scheduled job
        // combined (participant reminders + subscription reminders +
        // post-event feedback + certificates).
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
        },
      },
      preHandler: [validate({ body: InternalDispatchBody })],
      schema: {
        hide: true, // never exposed in the public Swagger UI
        summary: "Internal dispatcher entry point for Cloud Functions",
        body: {
          type: "object",
          required: ["key", "recipients"],
        },
      },
    },
    async (request, reply) => {
      const providedSecret = request.headers["x-internal-dispatch-secret"];
      const expected = config.INTERNAL_DISPATCH_SECRET;

      if (
        typeof providedSecret !== "string" ||
        providedSecret.length === 0 ||
        !timingSafeCompare(providedSecret, expected)
      ) {
        // 404 to make the surface invisible to unauthenticated probes.
        return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
      }

      const body = request.body as InternalDispatchBody;

      const recipients: NotificationRecipient[] = body.recipients.map((r) => ({
        ...(r.userId ? { userId: r.userId } : {}),
        ...(r.email ? { email: r.email } : {}),
        ...(r.phone ? { phone: r.phone } : {}),
        ...(r.fcmTokens ? { fcmTokens: r.fcmTokens } : {}),
        preferredLocale: r.preferredLocale,
      }));

      // Fire-and-forget inside the dispatcher — every failure turns into
      // a suppression audit event. We return 202 (accepted) regardless so
      // the caller's retry budget isn't spent on downstream provider
      // failures; the dispatch log + bounce webhook own the delivery
      // outcome.
      await notificationDispatcher.dispatch({
        key: body.key,
        recipients,
        params: body.params,
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
      });

      return reply.status(202).send({ success: true });
    },
  );
};
