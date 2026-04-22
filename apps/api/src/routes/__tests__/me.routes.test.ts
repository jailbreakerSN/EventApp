import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

// ─── Auth + Firestore mocks ────────────────────────────────────────────────

const mockVerifyIdToken = vi.fn();

type UserDoc = { fcmTokens?: unknown; updatedAt?: string } | undefined;
const userStore = new Map<string, UserDoc>();

function makeUserRef(uid: string) {
  return {
    get: async () => ({
      exists: userStore.has(uid),
      data: () => userStore.get(uid),
    }),
    update: async (patch: Record<string, unknown>) => {
      const existing = userStore.get(uid) ?? {};
      userStore.set(uid, { ...existing, ...patch } as UserDoc);
    },
  };
}

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  db: {
    collection: () => ({
      doc: (id: string) => makeUserRef(id),
    }),
    runTransaction: async (cb: (tx: unknown) => unknown) => {
      const tx = {
        get: (ref: { get: () => unknown }) => ref.get(),
        update: (ref: { update: (data: unknown) => unknown }, data: unknown) =>
          ref.update(data),
      };
      return cb(tx);
    },
  },
  COLLECTIONS: { USERS: "users" },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Import AFTER mocks
import { meRoutes } from "../me.routes";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(meRoutes, { prefix: "/v1/me" });
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      success: false,
      error: { code: "ERROR", message: error.message },
    });
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  userStore.clear();
  mockVerifyIdToken.mockResolvedValue({
    uid: "user-1",
    email: "user@example.com",
    email_verified: true,
    roles: ["participant"],
  });
  // Every test starts with an empty user doc so the transactional read
  // succeeds without extra setup.
  userStore.set("user-1", { fcmTokens: [] });
});

describe("POST /v1/me/fcm-tokens", () => {
  it("returns 201 with tokenFingerprint + status when registration succeeds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/fcm-tokens",
      headers: { authorization: "Bearer mock-token" },
      payload: { token: "fcm-web-abc", platform: "web", userAgent: "Mozilla/5.0" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("registered");
    expect(body.data.tokenFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(body.data.tokenCount).toBe(1);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/fcm-tokens",
      payload: { token: "fcm-web-abc", platform: "web" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when the token exceeds the 4096-char cap", async () => {
    const oversized = "x".repeat(4097);
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/fcm-tokens",
      headers: { authorization: "Bearer mock-token" },
      payload: { token: oversized, platform: "web" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when the platform is not in the allow-list", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/fcm-tokens",
      headers: { authorization: "Bearer mock-token" },
      payload: { token: "fcm-web-abc", platform: "desktop" },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /v1/me/fcm-tokens/:tokenFingerprint", () => {
  it("returns 204 when revoking a valid fingerprint", async () => {
    // Fingerprint validation only checks format; the service is a no-op
    // when the fingerprint doesn't match, so any 16-hex value works.
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/me/fcm-tokens/0123456789abcdef",
      headers: { authorization: "Bearer mock-token" },
    });

    expect(res.statusCode).toBe(204);
  });

  it("returns 400 for a malformed fingerprint", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/me/fcm-tokens/not-a-hex-string",
      headers: { authorization: "Bearer mock-token" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/me/fcm-tokens/0123456789abcdef",
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("DELETE /v1/me/fcm-tokens (revoke all)", () => {
  it("returns 204 and clears tokens", async () => {
    userStore.set("user-1", {
      fcmTokens: [
        {
          token: "a",
          platform: "web",
          registeredAt: "2026-04-01T00:00:00.000Z",
          lastSeenAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    });

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/me/fcm-tokens",
      headers: { authorization: "Bearer mock-token" },
    });

    expect(res.statusCode).toBe(204);
    expect(userStore.get("user-1")!.fcmTokens).toEqual([]);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/me/fcm-tokens",
    });

    expect(res.statusCode).toBe(401);
  });
});
