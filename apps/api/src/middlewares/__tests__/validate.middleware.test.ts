import { describe, it, expect, vi } from "vitest";
import { type FastifyRequest, type FastifyReply } from "fastify";
import { z } from "zod";
import { validate } from "../validate.middleware";

interface ErrorBody {
  success: boolean;
  error: {
    code: string;
    message: string;
    details: Array<{ source: string; field: string; message: string }>;
  };
}

interface MockReply {
  statusCode: number;
  body: ErrorBody | null;
  status(code: number): MockReply;
  send(data: unknown): MockReply;
}

// Minimal Fastify-like request/reply mocks
function mockRequest(overrides: { body?: unknown; params?: unknown; query?: unknown } = {}) {
  return {
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: {},
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest;
}

function mockReply(): MockReply {
  const reply: MockReply = {
    statusCode: 200,
    body: null,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(data: unknown) {
      reply.body = data as ErrorBody;
      return reply;
    },
  };
  return reply;
}

describe("validate middleware", () => {
  const TestBodySchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
  });

  const TestParamsSchema = z.object({
    id: z.string().uuid(),
  });

  const TestQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  });

  it("passes valid body through", async () => {
    const middleware = validate({ body: TestBodySchema });
    const req = mockRequest({ body: { name: "Test", email: "test@test.com" } });
    const reply = mockReply();

    await middleware(req, reply as unknown as FastifyReply);

    expect(reply.body).toBeNull(); // no error sent
    expect(req.body).toEqual({ name: "Test", email: "test@test.com" });
  });

  it("rejects invalid body with 400 and structured errors", async () => {
    const middleware = validate({ body: TestBodySchema });
    const req = mockRequest({ body: { name: "A", email: "not-email" } });
    const reply = mockReply();

    await middleware(req, reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(400);
    expect(reply.body!.success).toBe(false);
    expect(reply.body!.error.code).toBe("VALIDATION_ERROR");
    expect(reply.body!.error.details).toHaveLength(2);
    expect(reply.body!.error.details[0].source).toBe("body");
  });

  it("applies Zod defaults to query params", async () => {
    const middleware = validate({ query: TestQuerySchema });
    const req = mockRequest({ query: {} });
    const reply = mockReply();

    await middleware(req, reply as unknown as FastifyReply);

    expect(reply.body).toBeNull();
    expect(req.query).toEqual({ page: 1, limit: 20 });
  });

  it("coerces string query params to numbers", async () => {
    const middleware = validate({ query: TestQuerySchema });
    const req = mockRequest({ query: { page: "3", limit: "50" } });
    const reply = mockReply();

    await middleware(req, reply as unknown as FastifyReply);

    expect(req.query).toEqual({ page: 3, limit: 50 });
  });

  it("validates params", async () => {
    const middleware = validate({ params: TestParamsSchema });
    const req = mockRequest({ params: { id: "not-a-uuid" } });
    const reply = mockReply();

    await middleware(req, reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(400);
    expect(reply.body!.error.details[0].source).toBe("params");
  });

  it("validates body + params + query simultaneously", async () => {
    const middleware = validate({
      body: TestBodySchema,
      params: TestParamsSchema,
      query: TestQuerySchema,
    });
    const req = mockRequest({
      body: { name: "A" },
      params: { id: "bad" },
      query: { page: "-1" },
    });
    const reply = mockReply();

    await middleware(req, reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(400);
    const sources = reply.body!.error.details.map((d: unknown) => (d as { source: string }).source);
    expect(sources).toContain("body");
    expect(sources).toContain("params");
    expect(sources).toContain("query");
  });

  it("passes when no schemas provided", async () => {
    const middleware = validate({});
    const req = mockRequest();
    const reply = mockReply();

    await middleware(req, reply as unknown as FastifyReply);

    expect(reply.body).toBeNull();
  });
});
