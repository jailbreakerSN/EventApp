import { describe, it, expect, vi } from "vitest";
import { requirePermission, requireAllPermissions, requireAnyPermission } from "../permission.middleware";
import { buildAuthUser, buildOrganizerUser, buildSuperAdmin } from "@/__tests__/factories";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockRequest(user?: ReturnType<typeof buildAuthUser>) {
  return {
    user,
    permissions: undefined,
    log: { warn: vi.fn() },
  } as any;
}

function makeMockReply() {
  const reply = {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as any;
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
