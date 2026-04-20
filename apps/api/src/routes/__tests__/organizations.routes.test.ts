import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { organizationRoutes } from "../organizations.routes";
import { AppError } from "@/errors/app-error";

// ─── Organization route coverage ───────────────────────────────────────────
// Pins the member-management and invite surface at the request layer.
// Two things matter most here:
//
//   1. The invite-token leak floor: `POST /:orgId/invites` + `GET
//      /:orgId/invites` MUST NOT echo the raw `token` field back to
//      the caller. The service's `Invite` object still contains it
//      (the email delivery path needs it), but the route handler
//      strips it before responding. If a refactor forgets that, we
//      leak one-time invite tokens into logs + browser DevTools.
//
//   2. Mutating routes need `organization:manage_members` — that's
//      organizer / owner. Participants must always be 403.
//
// Service semantics (org creation, member dedup, analytics math) stay
// in `services/__tests__/organization.service.test.ts` etc.

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
}));

const mockOrgService = {
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  updateMemberRole: vi.fn(),
};

const mockInviteService = {
  createInvite: vi.fn(),
  listByOrganization: vi.fn(),
  revokeInvite: vi.fn(),
};

const mockAnalyticsService = {
  getOrgAnalytics: vi.fn(),
};

vi.mock("@/services/organization.service", () => ({
  organizationService: new Proxy(
    {},
    {
      get: (_t, p) => (mockOrgService as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/services/invite.service", () => ({
  inviteService: new Proxy(
    {},
    {
      get: (_t, p) => (mockInviteService as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/services/analytics.service", () => ({
  analyticsService: new Proxy(
    {},
    {
      get: (_t, p) => (mockAnalyticsService as Record<string, unknown>)[p as string],
    },
  ),
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(organizationRoutes, { prefix: "/v1/organizations" });
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: { code: error.code, message: error.message },
      });
    }
    return reply.status(error.statusCode ?? 500).send({
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
  // Default: authenticated organizer (holds both manage_members and
  // update permissions). Tests override for participant / unverified.
  mockVerifyIdToken.mockResolvedValue({
    uid: "org-admin-1",
    email: "org@example.com",
    email_verified: true,
    roles: ["organizer"],
    organizationId: "org-1",
  });
});

const authHeader = { authorization: "Bearer mock-token" };

// ─── Create + read + update ────────────────────────────────────────────────

describe("POST /v1/organizations — create", () => {
  it("401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      payload: { name: "Test Org", country: "SN" },
    });
    expect(res.statusCode).toBe(401);
    expect(mockOrgService.create).not.toHaveBeenCalled();
  });

  it("403 when email is not verified", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "org-admin-1",
      email: "org@example.com",
      email_verified: false,
      roles: ["organizer"],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: authHeader,
      payload: { name: "Test Org", country: "SN" },
    });
    expect(res.statusCode).toBe(403);
    expect(mockOrgService.create).not.toHaveBeenCalled();
  });

  it("201 as super_admin forwards body + user to service", async () => {
    // `organization:create` is currently granted only to super_admin
    // (see DEFAULT_ROLE_PERMISSIONS). Regular organizers become org
    // owners through a platform-onboarding flow, not via this endpoint.
    // The 403-for-organizer case is pinned by the
    // `permission-matrix.test.ts` snapshot so a grant change there
    // surfaces in the diff.
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "super-1",
      email: "platform@teranga.events",
      email_verified: true,
      roles: ["super_admin"],
    });
    mockOrgService.create.mockResolvedValue({
      id: "org-new",
      name: "Test Org",
      slug: "test-org",
      country: "SN",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: authHeader,
      payload: { name: "Test Org", slug: "test-org", country: "SN" },
    });
    expect(res.statusCode).toBe(201);
    expect(mockOrgService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test Org" }),
      expect.objectContaining({ uid: "super-1" }),
    );
  });
});

describe("GET /v1/organizations/:orgId", () => {
  it("401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/organizations/org-1",
    });
    expect(res.statusCode).toBe(401);
  });

  it("200 as organizer returns the org", async () => {
    mockOrgService.getById.mockResolvedValue({ id: "org-1", name: "Teranga Events" });

    const res = await app.inject({
      method: "GET",
      url: "/v1/organizations/org-1",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(mockOrgService.getById).toHaveBeenCalledWith("org-1", expect.any(Object));
  });
});

describe("PATCH /v1/organizations/:orgId — update", () => {
  it("403 as participant (missing organization:update)", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "participant-1",
      email: "p@example.com",
      email_verified: true,
      roles: ["participant"],
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/organizations/org-1",
      headers: authHeader,
      payload: { name: "Rename" },
    });
    expect(res.statusCode).toBe(403);
    expect(mockOrgService.update).not.toHaveBeenCalled();
  });

  it("200 as organizer updates org", async () => {
    mockOrgService.update.mockResolvedValue(undefined);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/organizations/org-1",
      headers: authHeader,
      payload: { name: "New Name" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockOrgService.update).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ name: "New Name" }),
      expect.any(Object),
    );
  });
});

// ─── Member management ─────────────────────────────────────────────────────

describe("POST /v1/organizations/:orgId/members", () => {
  it("403 as participant", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "participant-1",
      email: "p@example.com",
      email_verified: true,
      roles: ["participant"],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/members",
      headers: authHeader,
      payload: { userId: "user-new" },
    });
    expect(res.statusCode).toBe(403);
    expect(mockOrgService.addMember).not.toHaveBeenCalled();
  });

  it("400 when userId missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/members",
      headers: authHeader,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(mockOrgService.addMember).not.toHaveBeenCalled();
  });

  it("201 forwards userId + user to addMember", async () => {
    mockOrgService.addMember.mockResolvedValue(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/members",
      headers: authHeader,
      payload: { userId: "user-new" },
    });
    expect(res.statusCode).toBe(201);
    expect(mockOrgService.addMember).toHaveBeenCalledWith("org-1", "user-new", expect.any(Object));
  });
});

describe("DELETE /v1/organizations/:orgId/members", () => {
  it("204 forwards userId to removeMember", async () => {
    mockOrgService.removeMember.mockResolvedValue(undefined);
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/organizations/org-1/members",
      headers: authHeader,
      payload: { userId: "user-bye" },
    });
    expect(res.statusCode).toBe(204);
    expect(mockOrgService.removeMember).toHaveBeenCalledWith(
      "org-1",
      "user-bye",
      expect.any(Object),
    );
  });
});

describe("PATCH /v1/organizations/:orgId/members/:memberId/role", () => {
  it("400 on invalid role enum", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/organizations/org-1/members/u-1/role",
      headers: authHeader,
      payload: { role: "super_admin" }, // not in [admin|member|viewer]
    });
    expect(res.statusCode).toBe(400);
    expect(mockOrgService.updateMemberRole).not.toHaveBeenCalled();
  });

  it("200 forwards (orgId, memberId, role, user)", async () => {
    mockOrgService.updateMemberRole.mockResolvedValue(undefined);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/organizations/org-1/members/u-1/role",
      headers: authHeader,
      payload: { role: "admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockOrgService.updateMemberRole).toHaveBeenCalledWith(
      "org-1",
      "u-1",
      "admin",
      expect.any(Object),
    );
  });
});

// ─── Invites (the token-leak floor) ────────────────────────────────────────

describe("POST /v1/organizations/:orgId/invites", () => {
  it("response body must NOT include the raw token (token-leak floor)", async () => {
    // This is the most security-sensitive invariant on this route.
    // The service's Invite object contains `token` because the email
    // delivery path needs it, but the HTTP response must strip it so
    // the token never lands in browser DevTools, logs, or exports.
    //
    // Uses a token with the SAME shape as production (64-char hex from
    // crypto.randomBytes(32)). The literal-string search at the end of
    // this test also catches any FUTURE secret field that ever gets
    // added to the service return value and forgotten in the strip —
    // a `recoveryToken`, `rotatedToken`, etc. would all share the hex
    // shape, so the regex catches them too.
    const realisticToken = "a".repeat(32) + "b".repeat(32); // 64 hex chars
    mockInviteService.createInvite.mockResolvedValue({
      id: "inv-1",
      organizationId: "org-1",
      email: "teammate@example.com",
      role: "member",
      status: "pending",
      token: realisticToken,
      expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/invites",
      headers: authHeader,
      payload: { email: "teammate@example.com", role: "member" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data).toMatchObject({ id: "inv-1", email: "teammate@example.com" });
    expect(body.data.token).toBeUndefined();
    // Structural: no `token` field on the DTO.
    expect(Object.keys(body.data)).not.toContain("token");
    // Literal: the exact value we injected must not appear.
    expect(res.body).not.toContain(realisticToken);
    // Shape-based: any 64-char hex sequence in the body is suspect —
    // catches future fields that rename `token` to something else but
    // still carry the same secret shape (e.g. `recoveryToken`,
    // `rotatedToken`, `reissuedToken`).
    expect(res.body).not.toMatch(/[a-f0-9]{64}/);
  });

  it("403 as participant", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "participant-1",
      email: "p@example.com",
      email_verified: true,
      roles: ["participant"],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations/org-1/invites",
      headers: authHeader,
      payload: { email: "teammate@example.com", role: "member" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/organizations/:orgId/invites", () => {
  it("list response strips tokens from every item (token-leak floor)", async () => {
    // Same hex-shape argument as the POST test — realistic tokens so
    // the shape-based regex catches any future field renaming.
    const tokenA = "a".repeat(64);
    const tokenB = "b".repeat(64);
    mockInviteService.listByOrganization.mockResolvedValue([
      {
        id: "inv-1",
        organizationId: "org-1",
        email: "a@example.com",
        role: "member",
        status: "pending",
        token: tokenA,
        expiresAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        id: "inv-2",
        organizationId: "org-1",
        email: "b@example.com",
        role: "admin",
        status: "pending",
        token: tokenB,
        expiresAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/organizations/org-1/invites",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(2);
    for (const invite of body.data as Array<Record<string, unknown>>) {
      expect(invite.token).toBeUndefined();
      expect(Object.keys(invite)).not.toContain("token");
    }
    expect(res.body).not.toContain(tokenA);
    expect(res.body).not.toContain(tokenB);
    // Shape-based catch: any 64-char hex leaked anywhere in the body.
    expect(res.body).not.toMatch(/[a-f0-9]{64}/);
  });
});

describe("DELETE /v1/organizations/:orgId/invites/:inviteId", () => {
  it("204 forwards inviteId to service", async () => {
    mockInviteService.revokeInvite.mockResolvedValue(undefined);
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/organizations/org-1/invites/inv-42",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(204);
    expect(mockInviteService.revokeInvite).toHaveBeenCalledWith("inv-42", expect.any(Object));
  });
});
