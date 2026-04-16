import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { planRoutes, adminPlanRoutes } from "../plans.routes";

// ─── Mock auth middleware ──────────────────────────────────────────────────

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
  // Phase 7+ item #5: the analytics route pulls adminService in, which
  // imports `{ db, COLLECTIONS }` transitively. Stub enough of `db` for
  // `db.collection(...)` to resolve without actually hitting Firestore.
  db: {
    collection: () => ({
      limit: () => ({ get: () => Promise.resolve({ docs: [] }) }),
      doc: () => ({ get: () => Promise.resolve({ exists: false, data: () => null }) }),
      where: () => ({ get: () => Promise.resolve({ docs: [], empty: true }) }),
      get: () => Promise.resolve({ docs: [], empty: true }),
    }),
  },
  COLLECTIONS: {
    USERS: "users",
    ORGANIZATIONS: "organizations",
    EVENTS: "events",
    SUBSCRIPTIONS: "subscriptions",
    PLANS: "plans",
  },
}));

// ─── Mock plan service ─────────────────────────────────────────────────────

const mockPlanService = {
  getPublicCatalog: vi.fn(),
  getByKey: vi.fn(),
  listAll: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
};

vi.mock("@/services/plan.service", () => ({
  planService: new Proxy(
    {},
    {
      get: (_t, p) => (mockPlanService as Record<string, unknown>)[p as string],
    },
  ),
}));

// ─── Build app ─────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(planRoutes, { prefix: "/v1/plans" });
  await app.register(adminPlanRoutes, { prefix: "/v1/admin/plans" });

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
});

function authAs(overrides: Record<string, unknown> = {}) {
  mockVerifyIdToken.mockResolvedValue({
    uid: "user-1",
    email: "user@teranga.events",
    email_verified: true,
    roles: ["participant"],
    ...overrides,
  });
  return { authorization: "Bearer valid-token" };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("GET /v1/plans (public catalog)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plans" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the public catalog for any authenticated user", async () => {
    mockPlanService.getPublicCatalog.mockResolvedValue([{ id: "free", key: "free" }]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/plans",
      headers: authAs({ roles: ["participant"] }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: [{ id: "free", key: "free" }] });
  });
});

describe("GET /v1/admin/plans (superadmin)", () => {
  it("rejects non-superadmin callers at the permission middleware", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/plans",
      headers: authAs({ roles: ["organizer"], organizationId: "org-1" }),
    });
    expect(res.statusCode).toBe(403);
    expect(mockPlanService.listAll).not.toHaveBeenCalled();
  });

  it("allows superadmin callers", async () => {
    mockPlanService.listAll.mockResolvedValue([{ id: "free" }, { id: "custom_acme" }]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/plans",
      headers: authAs({ roles: ["super_admin"] }),
    });

    expect(res.statusCode).toBe(200);
    expect(mockPlanService.listAll).toHaveBeenCalled();
  });
});

describe("POST /v1/admin/plans", () => {
  const dto = {
    key: "custom_acme",
    name: { fr: "Acme", en: "Acme" },
    priceXof: 49900,
    limits: { maxEvents: 20, maxParticipantsPerEvent: 500, maxMembers: 10 },
    features: {
      qrScanning: true,
      paidTickets: true,
      customBadges: true,
      csvExport: true,
      smsNotifications: true,
      advancedAnalytics: true,
      speakerPortal: true,
      sponsorPortal: true,
      apiAccess: false,
      whiteLabel: false,
      promoCodes: true,
    },
    isPublic: false,
    sortOrder: 10,
  };

  it("rejects non-superadmin callers", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/plans",
      headers: { ...authAs({ roles: ["organizer"], organizationId: "org-1" }) },
      payload: dto,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an invalid payload (bad key)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/plans",
      headers: authAs({ roles: ["super_admin"] }),
      payload: { ...dto, key: "Has Spaces" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates a plan when authorized", async () => {
    mockPlanService.create.mockResolvedValue({ id: "plan-acme", ...dto });

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/plans",
      headers: authAs({ roles: ["super_admin"] }),
      payload: dto,
    });

    expect(res.statusCode).toBe(201);
    expect(mockPlanService.create).toHaveBeenCalled();
  });
});

describe("DELETE /v1/admin/plans/:planId", () => {
  it("archives a plan and returns 204", async () => {
    mockPlanService.archive.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/admin/plans/plan-acme",
      headers: authAs({ roles: ["super_admin"] }),
    });

    expect(res.statusCode).toBe(204);
    expect(mockPlanService.archive).toHaveBeenCalledWith("plan-acme", expect.any(Object));
  });
});
