import { describe, it, expect, vi } from "vitest";
import { type FastifyRequest, type FastifyReply } from "fastify";
import {
  requirePermission,
  requireAllPermissions,
  requireAnyPermission,
  requireOrganizationScope,
} from "../permission.middleware";
import { buildAuthUser, buildOrganizerUser, buildSuperAdmin } from "@/__tests__/factories";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockRequest(user?: ReturnType<typeof buildAuthUser>) {
  return {
    user,
    permissions: undefined,
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest;
}

function makeMockReply() {
  const reply = {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("requirePermission", () => {
  it("allows when user has the permission", async () => {
    const user = buildOrganizerUser("org-1");
    const request = makeMockRequest(user);
    const reply = makeMockReply();

    const middleware = requirePermission("event:create");
    await middleware(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("rejects 403 when user lacks the permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const request = makeMockRequest(user);
    const reply = makeMockReply();

    const middleware = requirePermission("event:create");
    await middleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "FORBIDDEN" }),
      }),
    );
  });

  it("returns 401 when user is not authenticated", async () => {
    const request = makeMockRequest(undefined);
    const reply = makeMockReply();

    const middleware = requirePermission("event:create");
    await middleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
  });

  it("super_admin bypasses all permission checks", async () => {
    const user = buildSuperAdmin();
    const request = makeMockRequest(user);
    const reply = makeMockReply();

    const middleware = requirePermission("event:create");
    await middleware(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("caches resolved permissions on request object", async () => {
    const user = buildOrganizerUser("org-1");
    const request = makeMockRequest(user);
    const reply = makeMockReply();

    const middleware = requirePermission("event:create");
    await middleware(request, reply);

    expect(request.permissions).toBeInstanceOf(Set);

    // Second call reuses cached permissions
    const middleware2 = requirePermission("event:update");
    await middleware2(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
  });
});

describe("requireAllPermissions", () => {
  it("allows when user has all permissions", async () => {
    const user = buildOrganizerUser("org-1");
    const request = makeMockRequest(user);
    const reply = makeMockReply();

    const middleware = requireAllPermissions(["event:create", "event:update"]);
    await middleware(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("rejects when user is missing one permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const request = makeMockRequest(user);
    const reply = makeMockReply();

    const middleware = requireAllPermissions(["registration:create", "event:create"]);
    await middleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
  });
});

describe("requireAnyPermission", () => {
  it("allows when user has at least one permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const request = makeMockRequest(user);
    const reply = makeMockReply();

    // participant has registration:cancel_own but not cancel_any
    const middleware = requireAnyPermission(["registration:cancel_own", "registration:cancel_any"]);
    await middleware(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("rejects when user has none of the permissions", async () => {
    const user = buildAuthUser({ roles: ["participant"] });
    const request = makeMockRequest(user);
    const reply = makeMockReply();

    const middleware = requireAnyPermission(["event:create", "event:update"]);
    await middleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
  });
});

// ─── SPEC: requireOrganizationScope (post-audit) ──────────────────────────
// Until this audit, `requireOrganizationScope` was exported and
// composable in route `preHandler` arrays but had ZERO test coverage.
// The middleware is the org-isolation floor — if it ever drops the
// `user.organizationId !== orgId` check, every route that relies on
// org scoping instead of service-level `requireOrganizationAccess()`
// becomes cross-tenant writable. Pin it.

function makeMockRequestWithParams(
  user: ReturnType<typeof buildAuthUser> | undefined,
  source: { params?: Record<string, unknown>; body?: Record<string, unknown> } = {},
): FastifyRequest {
  return {
    user,
    params: source.params ?? {},
    body: source.body ?? {},
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest;
}

describe("requireOrganizationScope", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const request = makeMockRequestWithParams(undefined, {
      params: { organizationId: "org-1" },
    });
    const reply = makeMockReply();
    const middleware = requireOrganizationScope("params");

    await middleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
  });

  it("allows same-org access (orgId matches user.organizationId)", async () => {
    const user = buildOrganizerUser("org-1");
    const request = makeMockRequestWithParams(user, {
      params: { organizationId: "org-1" },
    });
    const reply = makeMockReply();
    const middleware = requireOrganizationScope("params");

    await middleware(request, reply);

    // No status set — middleware falls through to the next handler.
    expect(reply.status).not.toHaveBeenCalled();
  });

  it("denies cross-org access with 403 (user in org-1 targets org-2)", async () => {
    // THE critical isolation property. Without this check, any
    // authenticated organizer could POST with a different orgId and
    // mutate cross-tenant data if the service didn't re-gate.
    const user = buildOrganizerUser("org-1");
    const request = makeMockRequestWithParams(user, {
      params: { organizationId: "org-2" },
    });
    const reply = makeMockReply();
    const middleware = requireOrganizationScope("params");

    await middleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("reads orgId from the body when source is `body`", async () => {
    // Subscription + analytics routes pass the orgId in the URL, but
    // some internal mutation endpoints pass it in the body. Both
    // source modes must enforce the same check.
    const user = buildOrganizerUser("org-1");
    const request = makeMockRequestWithParams(user, {
      body: { organizationId: "org-2" },
    });
    const reply = makeMockReply();
    const middleware = requireOrganizationScope("body");

    await middleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("super_admin bypasses the org scope check", async () => {
    // Platform admins legitimately touch cross-tenant data (suspend
    // an org, assign a custom plan). Verify the bypass is intact.
    const user = buildSuperAdmin();
    const request = makeMockRequestWithParams(user, {
      params: { organizationId: "any-other-org" },
    });
    const reply = makeMockReply();
    const middleware = requireOrganizationScope("params");

    await middleware(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("passes through when the route doesn't declare an orgId (middleware is advisory)", async () => {
    // If a route mounts this middleware but the request doesn't
    // include an orgId field (e.g. validation middleware already
    // rejected it, or the middleware is conservatively applied),
    // the scope check is a no-op. This is the documented behaviour
    // of the `orgId && ...` guard.
    const user = buildOrganizerUser("org-1");
    const request = makeMockRequestWithParams(user, { params: {} });
    const reply = makeMockReply();
    const middleware = requireOrganizationScope("params");

    await middleware(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
  });
});
