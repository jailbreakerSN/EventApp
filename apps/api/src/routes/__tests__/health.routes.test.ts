import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "../health.routes";

// Mock Firestore db used in the health route. The readiness probe calls
// db.listCollections() (changed from db.collection("__healthcheck__") because
// double-underscore identifiers are reserved by Firestore).
const mockListCollections = vi.fn();
vi.mock("@/config/firebase", () => ({
  db: {
    listCollections: () => mockListCollections(),
  },
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(healthRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBeDefined();
    expect(typeof body.uptime).toBe("number");
  });
});

describe("GET /ready", () => {
  it("returns 200 with firestore latency when healthy", async () => {
    mockListCollections.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ready");
    expect(body.checks.firestore.status).toBe("ok");
    expect(typeof body.checks.firestore.latencyMs).toBe("number");
  });

  it("returns 503 when firestore is unreachable", async () => {
    mockListCollections.mockRejectedValue(new Error("Connection refused"));

    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("not_ready");
    expect(body.checks.firestore.status).toBe("error");
    expect(body.checks.firestore.message).toContain("Connection refused");
  });
});
