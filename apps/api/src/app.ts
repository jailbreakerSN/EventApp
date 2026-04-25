import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import crypto from "crypto";
import { config } from "@/config/index";
import { registerRoutes } from "@/routes/index";
import { AppError } from "@/errors/app-error";
import { runWithContext, enrichContext } from "@/context/request-context";
import { registerNotificationListeners } from "@/events/listeners/notification.listener";
import { registerNotificationDispatcherListeners } from "@/events/listeners/notification-dispatcher.listener";
import { registerAuditListeners } from "@/events/listeners/audit.listener";
import { registerSocAlertListeners } from "@/events/listeners/soc-alert.listener";
import { flushFirestoreUsage } from "@/services/firestore-usage.service";
import { registerEffectivePlanListeners } from "@/events/listeners/effective-plan.listener";
import { registerEventDenormListeners } from "@/events/listeners/event-denorm.listener";
import { captureError } from "@/observability/sentry";
// Side-effect import: registers the email channel adapter on the
// NotificationDispatcherService so catalog-driven sends work out of the
// box. No exported bindings used here; the import statement is the wiring.
import "@/services/email/dispatcher-adapter";
// Side-effect import: registers the in-app channel adapter (Phase D.1) in
// the forward-looking ChannelAdapter registry. Dispatcher-driven in-app
// sends require this to land before the first dispatch fires.
import "@/services/notifications/channels/in-app.channel";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "requestId",
    bodyLimit: 1_048_576, // 1 MB — prevents oversized payload attacks
    // Security-review P1 (T2.3) — when running behind Cloud Run / a CDN
    // that terminates TLS upstream, we MUST honour the forwarded
    // address headers so `req.ip` reports the true client IP and
    // `@fastify/rate-limit` buckets per-caller instead of per-proxy.
    // Without this, a caller could inject a forged `X-Forwarded-For`
    // to cycle through rate-limit buckets. We trust the FIRST hop
    // (Cloud Run's front-end proxy); tune via env if a CDN is placed
    // in front.
    trustProxy: true,
  });

  // ─── Security ────────────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false, // handled at CDN level
  });

  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    credentials: true,
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req) => {
      // Hash the token to avoid leaking JWT content into logs/metrics
      const token = req.headers.authorization;
      if (token?.startsWith("Bearer ")) {
        return crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
      }
      return req.ip;
    },
  });

  // ─── Content-Type Enforcement ─────────────────────────────────────────────
  // Mutation endpoints must send JSON. Prevents accidental form-encoded or
  // multipart payloads from reaching handlers that expect parsed JSON bodies.
  app.addHook("onRequest", (request, reply, done) => {
    const mutationMethods = ["POST", "PATCH", "PUT"];
    if (mutationMethods.includes(request.method)) {
      const contentType = request.headers["content-type"];
      if (contentType && !contentType.includes("application/json")) {
        reply.status(415).send({
          success: false,
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Content-Type must be application/json",
          },
        });
        return;
      }
    }
    done();
  });

  // ─── Request Context (AsyncLocalStorage) ─────────────────────────────────
  // Wraps each request in an AsyncLocalStorage context so services can access
  // requestId, userId, timing without explicit parameter threading.
  app.addHook("onRequest", (request, _reply, done) => {
    runWithContext(
      {
        requestId: request.id,
        startTime: Date.now(),
      },
      () => done(),
    );
  });

  // Enrich context with user info after authentication middleware runs
  app.addHook("preHandler", (request, _reply, done) => {
    if (request.user) {
      enrichContext(request.user.uid, request.user.organizationId);
    }
    done();
  });

  // ─── Request Timing ──────────────────────────────────────────────────────
  app.addHook("onResponse", (request, reply, done) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      "request completed",
    );
    done();
  });

  // ─── Sprint-3 T4.2 — Firestore read-volume flush ─────────────────────────
  // Pushes the per-request `firestoreReads` counter into the
  // `firestoreUsage/{orgId}_{day}` aggregate doc. Fire-and-forget:
  // a write failure here must not block the response or surface to
  // the caller, so we swallow + log to stderr only. Skipped when:
  //   - the request had no organisation context (anonymous /
  //     pre-auth probes)
  //   - the request didn't actually read Firestore (rare — most
  //     authed endpoints touch at least the user doc)
  //   - the writer itself targets `firestoreUsage` (avoid an
  //     infinite recursion of usage tracking the usage tracker)
  app.addHook("onResponse", (_request, _reply, done) => {
    void flushFirestoreUsage();
    done();
  });

  // ─── API Documentation ──────────────────────────────────────────────────
  // Sprint-4 T3.3 closure — Swagger always-on so the OpenAPI spec
  // is reachable in every environment via the admin-gated
  // `/v1/admin/openapi.json` endpoint. The Swagger UI itself
  // (interactive docs at `/docs`) stays non-production only so
  // public traffic can't enumerate the surface without an admin
  // session.
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Teranga API",
        description:
          "African Event Management Platform — REST API for events, registrations, badges, and users",
        version: "0.1.0",
        contact: { name: "Teranga Team", email: "dev@teranga.events" },
      },
      servers: [
        config.NODE_ENV === "production"
          ? { url: "https://api.teranga.events", description: "Production" }
          : { url: `http://localhost:${config.PORT}`, description: "Local dev" },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "Firebase JWT",
            description: "Firebase ID token obtained via Firebase Auth SDK",
          },
          ApiKeyAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "terk_<env>_<40chars>_<4chksum>",
            description:
              "Organization API key (T2.3). Issued via /admin/organizations/[id]?tab=api-keys.",
          },
        },
      },
      tags: [
        { name: "Events", description: "Event CRUD and publishing" },
        { name: "Registrations", description: "Registration, check-in, and QR validation" },
        { name: "Badges", description: "Badge generation, templates, and offline sync" },
        { name: "Users", description: "User profiles and FCM tokens" },
        { name: "Organizations", description: "Multi-tenant organization management" },
        { name: "Admin", description: "Platform administration — super-admin only" },
        { name: "Coupons", description: "Plan-level coupons + redemption" },
        { name: "Notifications", description: "Notification settings + delivery dashboard" },
      ],
    },
  });

  if (config.NODE_ENV !== "production") {
    // Interactive UI — non-production only. Operators in
    // production reach the OpenAPI spec via the admin-gated JSON
    // endpoint and import it into Postman / Bruno / their own
    // tooling. Avoids accidental enumeration of the API surface
    // by a curious unauthenticated visitor.
    await app.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { deepLinking: true },
    });
  }

  // ─── Domain Event Listeners ───────────────────────────────────────────────
  registerNotificationListeners();
  registerNotificationDispatcherListeners();
  registerAuditListeners();
  registerEffectivePlanListeners();
  registerEventDenormListeners();
  // Sprint-3 T4.1 closure — fire-and-forget SOC alerts on critical
  // audit actions. No-ops when SOC_ALERT_WEBHOOK_URL is unset.
  registerSocAlertListeners();

  // ─── Routes ───────────────────────────────────────────────────────────────
  await registerRoutes(app);

  // ─── Global Error Handler ─────────────────────────────────────────────────
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // ── AppError (operational, expected) ────────────────────────────────
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, method: request.method, url: request.url }, error.message);
        // Only 5xx operational errors go to Sentry — 4xx is client error noise.
        captureError(error, {
          requestId: request.id,
          method: request.method,
          url: request.url,
          code: error.code,
        });
      } else {
        request.log.warn(
          { code: error.code, method: request.method, url: request.url },
          error.message,
        );
      }
      return reply.status(error.statusCode).send({
        success: false,
        error: error.toJSON(),
      });
    }

    // ── Fastify validation errors ──────────────────────────────────────
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "La validation de la requête a échoué",
          details: error.validation,
        },
      });
    }

    // ── Rate limit ─────────────────────────────────────────────────────
    if (error.statusCode === 429) {
      return reply.status(429).send({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Trop de requêtes. Veuillez réessayer plus tard.",
        },
      });
    }

    // ── Firestore FAILED_PRECONDITION (missing composite index) ────────
    // Surface a specific error code + console hint so developers don't have
    // to spelunk the stack trace to find the Firestore link. The real-world
    // error can arrive in several shapes depending on the Firebase SDK
    // version and wrapping:
    //   - `error.code === 9`                       (raw gRPC numeric code)
    //   - `error.code === "failed-precondition"`   (Firebase JS SDK string code)
    //   - `error.code === "FAILED_PRECONDITION"`   (some admin builds)
    //   - code nested under `error.cause.code`     (re-thrown/wrapped errors)
    //   - none of the above, but message prefixed with "9 FAILED_PRECONDITION:"
    //     (google-gax stringifies gRPC status into the message)
    // The message-based check is the most reliable discriminator — the Firestore
    // index-missing error uniquely contains "query requires an index".
    const message = typeof error.message === "string" ? error.message : "";
    const errorObj = error as unknown as {
      code?: unknown;
      cause?: { code?: unknown };
    };
    const code = errorObj.code ?? errorObj.cause?.code;
    const isFailedPrecondition =
      code === 9 ||
      code === "failed-precondition" ||
      code === "FAILED_PRECONDITION" ||
      message.startsWith("9 FAILED_PRECONDITION") ||
      message.includes("FAILED_PRECONDITION:");
    const isMissingIndex = message.includes("query requires an index");
    if (isFailedPrecondition && isMissingIndex) {
      const urlMatch = message.match(/https:\/\/console\.firebase\.google\.com[^\s"]+/);
      const consoleUrl = urlMatch?.[0];
      request.log.error(
        {
          err: error,
          method: request.method,
          url: request.url,
          firestoreIndexUrl: consoleUrl,
          hint: "Declare this composite index in infrastructure/firebase/firestore.indexes.json and redeploy.",
        },
        "Firestore query missing composite index (FAILED_PRECONDITION)",
      );
      captureError(error, {
        requestId: request.id,
        method: request.method,
        url: request.url,
        firestoreIndexUrl: consoleUrl,
      });
      return reply.status(500).send({
        success: false,
        error: {
          code: "FIRESTORE_INDEX_MISSING",
          message:
            config.NODE_ENV === "production"
              ? "Une erreur interne s'est produite."
              : `A Firestore composite index is missing. Declare it in firestore.indexes.json${consoleUrl ? ` — quick-create: ${consoleUrl}` : ""}.`,
        },
      });
    }

    // ── Unexpected errors ──────────────────────────────────────────────
    request.log.error({ err: error, method: request.method, url: request.url }, error.message);
    captureError(error, {
      requestId: request.id,
      method: request.method,
      url: request.url,
    });

    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      success: false,
      error: {
        code: statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message:
          config.NODE_ENV === "production" && statusCode >= 500
            ? "Une erreur inattendue s'est produite"
            : error.message,
      },
    });
  });

  // ─── Not Found Handler ───────────────────────────────────────────────────
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      success: false,
      error: { code: "NOT_FOUND", message: "Route introuvable" },
    });
  });

  return app;
}
