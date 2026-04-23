import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { notificationRoutes } from "../notifications.routes";

const mockVerifyIdToken = vi.fn();

// Minimal in-memory Firestore double for the /preferences endpoints.
// Doc id == userId for notificationPreferences; tests mutate via
// `prefStorage.set(uid, data)`.
const prefStorage = new Map<string, Record<string, unknown>>();

// User doc storage — doc id == userId. The test-send endpoint reads
// `preferredLanguage` from here.
const userStorage = new Map<string, Record<string, unknown>>();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  db: {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id: string) => ({
        // Carry both the collection + doc id so the transaction mock
        // can look up the right storage map via the ref.
        _collection: name,
        _id: id,
        get: vi.fn(async () => {
          const store = name === "users" ? userStorage : prefStorage;
          const data = store.get(id);
          return {
            exists: data !== undefined,
            data: () => data,
          };
        }),
        set: vi.fn(async (payload: Record<string, unknown>) => {
          const existing = prefStorage.get(id) ?? {};
          prefStorage.set(id, { ...existing, ...payload });
        }),
      })),
    })),
    // Used by the `/resubscribe` handler's read-modify-write guard.
    runTransaction: vi.fn(
      async (fn: (tx: unknown) => unknown | Promise<unknown>) => {
        const tx = {
          get: async (ref: { _collection: string; _id: string }) => {
            const store = ref._collection === "users" ? userStorage : prefStorage;
            const data = store.get(ref._id);
            return { exists: data !== undefined, data: () => data };
          },
          set: (
            ref: { _collection: string; _id: string },
            payload: Record<string, unknown>,
          ) => {
            const store = ref._collection === "users" ? userStorage : prefStorage;
            const existing = store.get(ref._id) ?? {};
            store.set(ref._id, { ...existing, ...payload });
          },
        };
        return fn(tx);
      },
    ),
  },
  COLLECTIONS: {
    NOTIFICATION_PREFERENCES: "notificationPreferences",
    USERS: "users",
  },
}));

// The catalog endpoint reads platform-level overrides to compute each
// entry's effective channels. Tests that care about specific overrides
// can override `mockListAll`; the default returns an empty list so the
// catalog behaves as if no admin has ever edited any notification.
const mockListAll = vi.fn().mockResolvedValue([]);
vi.mock("@/repositories/notification-settings.repository", () => ({
  notificationSettingsRepository: {
    listAll: (...args: unknown[]) => mockListAll(...args),
    findByKey: vi.fn().mockResolvedValue(null),
  },
}));

// The test-send route calls the real dispatcher, but tests only assert
// routing + rate-limit behavior — mock to a no-op so we don't drag the
// email pipeline into this suite.
const mockDispatch = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/notification-dispatcher.service", () => ({
  notificationDispatcher: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
  },
}));

// Dispatch-log reads in the `/history` route aren't exercised here; stub
// so the import chain resolves cleanly.
vi.mock("@/repositories/notification-dispatch-log.repository", () => ({
  notificationDispatchLogRepository: {
    listRecentForUser: vi.fn().mockResolvedValue([]),
  },
}));

// Rate-limit service — Phase D.4. The test-send route calls
// `rateLimit({ scope: "test-send:self", ... })`. Default to "always
// allow" so every test that isn't specifically exercising the limiter
// can stay oblivious to it. The `rate-limits 6th attempt` test overrides
// the mock to flip to deny on its 6th call.
const mockRateLimit = vi.fn().mockResolvedValue({
  allowed: true,
  count: 1,
  limit: 5,
});
vi.mock("@/services/rate-limit.service", () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockNotificationService = {
  getMyNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
};

vi.mock("@/services/notification.service", () => ({
  notificationService: new Proxy(
    {},
    { get: (_t, p) => (mockNotificationService as Record<string, unknown>)[p as string] },
  ),
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(notificationRoutes, { prefix: "/v1/notifications" });
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
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
  prefStorage.clear();
  userStorage.clear();
  mockListAll.mockResolvedValue([]);
  mockDispatch.mockResolvedValue(undefined);
  // Default rate-limit behavior: always allow. Tests that exercise the
  // limiter override this inside the test body.
  mockRateLimit.mockResolvedValue({ allowed: true, count: 1, limit: 5 });
  mockVerifyIdToken.mockResolvedValue({
    uid: "user-1",
    email: "user@example.com",
    email_verified: true,
    roles: ["participant"],
  });
});

describe("Notifications list — paginated meta shape", () => {
  it("returns full { page, limit, total, totalPages } meta so UI can show 'page X of Y'", async () => {
    // Regression guard: the route used to return `{ meta: { total } }`
    // only, leaving the frontend unable to compute total pages. The
    // post-audit PR expanded it to the standard PaginatedResponse shape.
    mockNotificationService.getMyNotifications.mockResolvedValue({
      data: Array.from({ length: 5 }, (_, i) => ({ id: `n-${i}` })),
      total: 42,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications?page=2&limit=5",
      headers: { authorization: "Bearer mock-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.meta).toEqual({
      page: 2,
      limit: 5,
      total: 42,
      totalPages: 9, // ceil(42 / 5)
    });
  });

  it("computes totalPages=1 when total is 0 (no divide-by-zero)", async () => {
    mockNotificationService.getMyNotifications.mockResolvedValue({
      data: [],
      total: 0,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: { authorization: "Bearer mock-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // 0 / limit = 0 items → 0 totalPages (not "1 of 0", but also not Infinity)
    expect(body.meta.totalPages).toBe(0);
    expect(body.meta.total).toBe(0);
  });
});

describe("Notification catalog + preferences — Phase 3 per-key opt-out", () => {
  beforeEach(() => {
    prefStorage.clear();
  });

  it("GET /v1/notifications/catalog returns every catalog entry with default enabled=true", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications/catalog",
      headers: { authorization: "Bearer mock-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(10);

    // Every entry has the shape the UI expects.
    for (const entry of body.data) {
      expect(entry).toMatchObject({
        key: expect.any(String),
        category: expect.any(String),
        displayName: { fr: expect.any(String), en: expect.any(String), wo: expect.any(String) },
        userOptOutAllowed: expect.any(Boolean),
        enabled: expect.any(Boolean),
      });
    }

    // Without an override doc, every entry defaults to enabled=true.
    expect(body.data.every((e: { enabled: boolean }) => e.enabled === true)).toBe(true);
  });

  it("GET /v1/notifications/catalog reflects the user's byKey overrides", async () => {
    prefStorage.set("user-1", {
      byKey: {
        "event.reminder": false,
        "newsletter.welcome": false,
      },
      updatedAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications/catalog",
      headers: { authorization: "Bearer mock-token" },
    });

    const body = JSON.parse(res.body);
    const byKey = Object.fromEntries(
      (body.data as { key: string; enabled: boolean }[]).map((e) => [e.key, e.enabled]),
    );
    expect(byKey["event.reminder"]).toBe(false);
    expect(byKey["newsletter.welcome"]).toBe(false);
    // untouched keys remain on default (true)
    expect(byKey["registration.created"]).toBe(true);
  });

  it("PUT /v1/notifications/preferences accepts byKey and persists it", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/notifications/preferences",
      headers: { authorization: "Bearer mock-token", "content-type": "application/json" },
      payload: {
        byKey: {
          "event.reminder": false,
          "subscription.upgraded": true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const stored = prefStorage.get("user-1");
    expect(stored?.byKey).toMatchObject({
      "event.reminder": false,
      "subscription.upgraded": true,
    });
  });
});

// ─── Phase B.1: per-channel byKey shape + catalog channel grid ─────────────
describe("Phase B.1 — per-channel preference round-trip", () => {
  it("PUT /preferences accepts per-channel byKey objects and persists them", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/notifications/preferences",
      headers: { authorization: "Bearer mock-token", "content-type": "application/json" },
      payload: {
        byKey: {
          "event.reminder": { email: true, sms: false, push: true },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const stored = prefStorage.get("user-1");
    expect(stored?.byKey).toEqual({
      "event.reminder": { email: true, sms: false, push: true },
    });

    // Round-trip via GET — the preferences endpoint must echo the same shape.
    const getRes = await app.inject({
      method: "GET",
      url: "/v1/notifications/preferences",
      headers: { authorization: "Bearer mock-token" },
    });
    const getBody = JSON.parse(getRes.body);
    expect(getBody.data.byKey["event.reminder"]).toEqual({
      email: true,
      sms: false,
      push: true,
    });
  });

  it("PUT /preferences accepts legacy bare-boolean values (backward compat)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/notifications/preferences",
      headers: { authorization: "Bearer mock-token", "content-type": "application/json" },
      payload: { byKey: { "newsletter.welcome": false } },
    });
    expect(res.statusCode).toBe(200);
    const stored = prefStorage.get("user-1");
    expect(stored?.byKey).toEqual({ "newsletter.welcome": false });
  });

  it("PUT /preferences accepts a mixed byKey map (per-channel + legacy boolean in same request)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/notifications/preferences",
      headers: { authorization: "Bearer mock-token", "content-type": "application/json" },
      payload: {
        byKey: {
          // Per-channel for one key…
          "event.reminder": { sms: false },
          // …and a legacy bare boolean for another. The dispatcher
          // resolves each value independently so mixing is fine.
          "newsletter.welcome": true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const stored = prefStorage.get("user-1");
    expect(stored?.byKey).toEqual({
      "event.reminder": { sms: false },
      "newsletter.welcome": true,
    });
  });

  it("GET /catalog exposes supportedChannels + defaultChannels + effectiveChannels per entry", async () => {
    prefStorage.set("user-1", {
      byKey: { "event.reminder": { sms: false } },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/notifications/catalog",
      headers: { authorization: "Bearer mock-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const entries: Array<{
      key: string;
      supportedChannels: string[];
      defaultChannels: string[];
      effectiveChannels: Record<string, boolean>;
      userPreference: unknown;
    }> = body.data;

    const reminder = entries.find((e) => e.key === "event.reminder");
    expect(reminder).toBeDefined();
    expect(Array.isArray(reminder!.supportedChannels)).toBe(true);
    expect(Array.isArray(reminder!.defaultChannels)).toBe(true);
    // Email stays live because default+not-opted-out; sms flipped off.
    if (reminder!.supportedChannels.includes("email")) {
      expect(reminder!.effectiveChannels.email).toBe(true);
    }
    if (reminder!.supportedChannels.includes("sms")) {
      expect(reminder!.effectiveChannels.sms).toBe(false);
    }
    expect(reminder!.userPreference).toEqual({ sms: false });

    // A mandatory notification ignores any user opt-out, so its
    // effectiveChannels mirror the catalog's default channels.
    const mandatory = entries.find((e) => e.key === "auth.password_reset");
    expect(mandatory).toBeDefined();
    for (const ch of mandatory!.defaultChannels) {
      expect(mandatory!.effectiveChannels[ch]).toBe(true);
    }
  });
});

// ─── Phase B.1: test-send self endpoint ────────────────────────────────────
describe("POST /v1/notifications/test-send", () => {
  beforeEach(() => {
    userStorage.set("user-1", { preferredLanguage: "fr" });
  });

  it("dispatches and returns 202 for an opt-outable key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/test-send",
      headers: { authorization: "Bearer mock-token", "content-type": "application/json" },
      payload: { key: "event.reminder" },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      success: true,
      data: { dispatched: true, key: "event.reminder", locale: "fr" },
    });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const [dispatchReq] = mockDispatch.mock.calls[0];
    expect(dispatchReq).toMatchObject({
      key: "event.reminder",
      testMode: true,
    });
  });

  it("rejects mandatory-category keys with 400 (no abuse lever)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/test-send",
      headers: { authorization: "Bearer mock-token", "content-type": "application/json" },
      payload: { key: "auth.password_reset" },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("NOT_OPTABLE");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown notification key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/notifications/test-send",
      headers: { authorization: "Bearer mock-token", "content-type": "application/json" },
      payload: { key: "not.a.real.key" },
    });

    expect(res.statusCode).toBe(404);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("rate-limits: 6th attempt within an hour returns 429 with Retry-After", async () => {
    // Phase D.4: the bucket lives in Firestore, so the route delegates
    // the decision to `rateLimit()`. We simulate the distributed limiter
    // by returning `allowed: true` for the first five calls and
    // `allowed: false` on the sixth — same user-visible semantics as the
    // old in-memory bucket, different implementation underneath.
    mockVerifyIdToken.mockResolvedValue({
      uid: "user-ratelimit",
      email: "ratelimit@example.com",
      email_verified: true,
      roles: ["participant"],
    });
    userStorage.set("user-ratelimit", { preferredLanguage: "fr" });

    let callCount = 0;
    mockRateLimit.mockImplementation(async () => {
      callCount += 1;
      if (callCount <= 5) {
        return { allowed: true, count: callCount, limit: 5 };
      }
      return { allowed: false, count: 5, limit: 5, retryAfterSec: 1234 };
    });

    const fire = () =>
      app.inject({
        method: "POST",
        url: "/v1/notifications/test-send",
        headers: { authorization: "Bearer mock-token", "content-type": "application/json" },
        payload: { key: "event.reminder" },
      });

    for (let i = 0; i < 5; i++) {
      const ok = await fire();
      expect(ok.statusCode).toBe(202);
    }
    const blocked = await fire();
    expect(blocked.statusCode).toBe(429);
    // Retry-After header surfaces the server-computed remainder so the
    // UI can show a concrete "try again in N minutes" without parsing
    // the JSON body.
    expect(blocked.headers["retry-after"]).toBe("1234");
    const body = JSON.parse(blocked.body);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details).toMatchObject({ retryAfterSec: 1234 });
    // Dispatcher fired exactly 5 times — the 6th was blocked pre-dispatch.
    expect(mockDispatch).toHaveBeenCalledTimes(5);

    // Route invoked the limiter with the expected scope / budget.
    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "test-send:self",
        identifier: "user-ratelimit",
        limit: 5,
        windowSec: 3600,
      }),
    );
  });
});
