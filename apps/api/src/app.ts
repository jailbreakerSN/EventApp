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
import { registerAuditListeners } from "@/events/listeners/audit.listener";
import { captureError } from "@/observability/sentry";

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

  // ─── API Documentation (non-production) ──────────────────────────────────
  if (config.NODE_ENV !== "production") {
    await app.register(swagger, {
      openapi: {
        info: {
          title: "Teranga API",
          description:
            "African Event Management Platform — REST API for events, registrations, badges, and users",
          version: "0.1.0",
          contact: { name: "Teranga Team", email: "dev@teranga.events" },
        },
        servers: [{ url: `http://localhost:${config.PORT}`, description: "Local dev" }],
        components: {
          securitySchemes: {
            BearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "Firebase JWT",
              description: "Firebase ID token obtained via Firebase Auth SDK",
            },
          },
        },
        tags: [
          { name: "Events", description: "Event CRUD and publishing" },
          { name: "Registrations", description: "Registration, check-in, and QR validation" },
          { name: "Badges", description: "Badge generation, templates, and offline sync" },
          { name: "Users", description: "User profiles and FCM tokens" },
          { name: "Organizations", description: "Multi-tenant organization management" },
        ],
      },
    });

    await app.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { deepLinking: true },
    });
  }

  // ─── Domain Event Listeners ───────────────────────────────────────────────
  registerNotificationListeners();
  registerAuditListeners();

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
