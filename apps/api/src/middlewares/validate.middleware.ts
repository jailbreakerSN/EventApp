import { type FastifyRequest, type FastifyReply } from "fastify";
import { type ZodSchema } from "zod";

/**
 * Generic Zod validation middleware for Fastify.
 *
 * Validates request body, params, and/or query against Zod schemas.
 * On failure, returns a 400 with structured error details showing
 * each field that failed validation.
 *
 * Usage:
 *   preHandler: [authenticate, validate({ body: CreateEventSchema })]
 *   preHandler: [validate({ params: z.object({ id: z.string() }), query: PaginationSchema })]
 */
interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export function validate(schemas: ValidationSchemas) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const errors: Array<{ source: string; field: string; message: string }> = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(request.body);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            source: "body",
            field: issue.path.join("."),
            message: issue.message,
          });
        }
      } else {
        // Replace body with parsed/coerced values (defaults, transforms)
        (request as unknown as Record<string, unknown>).body = result.data;
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(request.params);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            source: "params",
            field: issue.path.join("."),
            message: issue.message,
          });
        }
      } else {
        (request as unknown as Record<string, unknown>).params = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(request.query);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            source: "query",
            field: issue.path.join("."),
            message: issue.message,
          });
        }
      } else {
        (request as unknown as Record<string, unknown>).query = result.data;
      }
    }

    if (errors.length > 0) {
      return reply.status(400).send({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: errors,
        },
      });
    }
  };
}
