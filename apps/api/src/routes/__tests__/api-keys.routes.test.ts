import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * T2.3 — Route-level integration tests.
 *
 * We mock the service boundary + firebase but keep the Fastify request
 * lifecycle (auth → validate → permission → handler) real. The route
 * layer should be paper-thin, so the service mock is sufficient.
 */

const mockVerifyIdToken = vi.fn();

const mockIssue = vi.fn();
const mockList = vi.fn();
const mockGet = vi.fn();
const mockRevoke = vi.fn();
const mockRotate = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  db: { collection: () => ({}) },
  COLLECTIONS: { API_KEYS: "apiKeys" },
}));

vi.mock("@/services/api-keys.service", () => ({
  apiKeysService: {
    issue: (...args: unknown[]) => mockIssue(...args),
    list: (...args: unknown[]) => mockList(...args),
    get: (...args: unknown[]) => mockGet(...args),
    revoke: (...args: unknown[]) => mockRevoke(...args),
    rotate: (...args: unknown[]) => mockRotate(...args),
    verify: vi.fn().mockResolvedValue(null),
    expandScopes: (s: string[]) => s,
  },
  parseApiKey: () => null,
}));

// Import AFTER mocks so the routes pick up our mocked service.
import { apiKeysRoutes } from "../api-keys.routes";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(apiKeysRoutes);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function authHeader() {
  return { authorization: "Bearer fake-id-token" };
}

function asOrganizer(overrides: Record<string, unknown> = {}) {
  return mockVerifyIdToken.mockResolvedValue({
    uid: "admin-1",
    email: "admin@teranga.test",
    email_verified: true,
    roles: ["organizer"],
    organizationId: "org-1",
    ...overrides,
  });
}

function asParticipant() {
  return mockVerifyIdToken.mockResolvedValue({
    uid: "user-1",
    email: "user@test",
    email_verified: true,
    roles: ["participant"],
    organizationId: "org-1",
  });
}

describe("POST /v1/organizations/:orgId/api-keys", () => {
  it("401s without an authorization header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/api-keys",
      payload: { name: "k", scopes: ["event:read"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a participant (missing organization:manage_billing)", async () => {
    asParticipant();
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/api-keys",
      headers: authHeader(),
      payload: { name: "k", scopes: ["event:read"] },
    });
    expect(res.statusCode).toBe(403);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("201s + returns plaintext once for an organizer", async () => {
    asOrganizer();
    mockIssue.mockResolvedValue({
      apiKey: {
        id: "abc1234567",
        organizationId: "org-1",
        name: "k",
        hashPrefix: "abc1234567",
        keyHash: "hash",
        scopes: ["event:read"],
        environment: "live",
        status: "active",
        createdBy: "admin-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
        lastUsedIp: null,
        revokedAt: null,
        revokedBy: null,
        revocationReason: null,
      },
      plaintext: "terk_live_abc_def",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/api-keys",
      headers: authHeader(),
      payload: { name: "k", scopes: ["event:read"], environment: "live" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.plaintext).toBe("terk_live_abc_def");
    // keyHash stripped out.
    expect(body.data.apiKey.keyHash).toBe("");
  });

  it("400s on an empty scopes array", async () => {
    asOrganizer();
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/api-keys",
      headers: authHeader(),
      payload: { name: "k", scopes: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(mockIssue).not.toHaveBeenCalled();
  });
});

describe("GET /v1/organizations/:orgId/api-keys", () => {
  it("lists for an organizer", async () => {
    asOrganizer();
    mockList.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/organizations/org-1/api-keys?page=1&limit=20",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /v1/organizations/:orgId/api-keys/:apiKeyId/revoke", () => {
  it("revokes a key for an organizer", async () => {
    asOrganizer();
    mockRevoke.mockResolvedValue({
      id: "abc1234567",
      status: "revoked",
      organizationId: "org-1",
      keyHash: "",
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/api-keys/abc1234567/revoke",
      headers: authHeader(),
      payload: { reason: "leaked" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockRevoke).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "admin-1" }),
      "org-1",
      "abc1234567",
      "leaked",
    );
  });
});

describe("POST /v1/organizations/:orgId/api-keys/:apiKeyId/rotate", () => {
  it("returns the new plaintext once", async () => {
    asOrganizer();
    mockRotate.mockResolvedValue({
      newApiKey: {
        id: "new1234567",
        status: "active",
        keyHash: "",
      },
      plaintext: "terk_live_new",
      revokedApiKeyId: "old1234567",
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/api-keys/old1234567/rotate",
      headers: authHeader(),
      payload: { reason: "rotated" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.plaintext).toBe("terk_live_new");
    expect(body.data.revokedApiKeyId).toBe("old1234567");
  });
});
