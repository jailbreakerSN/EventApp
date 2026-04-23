import { describe, it, expect, vi, beforeEach } from "vitest";
import { type FastifyRequest, type FastifyReply } from "fastify";
import {
  authenticate,
  optionalAuth,
  requireEmailVerified,
  type AuthUser,
} from "../auth.middleware";
import { type UserRole } from "@teranga/shared-types";

// Mock firebase-admin/auth
const mockVerifyIdToken = vi.fn();
vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
}));

function makeMockRequest(authHeader?: string) {
  return {
    headers: {
      authorization: authHeader,
    },
    user: undefined,
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest;
}

function makeMockRequestWithUser(user: AuthUser) {
  return {
    headers: {},
    user,
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest;
}

function makeMockReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authenticate", () => {
  it("sets request.user with decoded token data", async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: "user-1",
      email: "test@test.com",
      email_verified: true,
      roles: ["organizer"],
      organizationId: "org-1",
    });

    const request = makeMockRequest("Bearer valid-token");
    const reply = makeMockReply();

    await authenticate(request, reply);

    expect(request.user).toEqual({
      uid: "user-1",
      email: "test@test.com",
      roles: ["organizer"],
      organizationId: "org-1",
      emailVerified: true,
    });
    expect(reply.status).not.toHaveBeenCalled();
  });

  it("sets emailVerified=false when the claim is missing or falsy", async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: "user-2",
      email: "new@test.com",
      // no email_verified claim
    });

    const request = makeMockRequest("Bearer valid-token");
    const reply = makeMockReply();

    await authenticate(request, reply);

    expect(request.user?.emailVerified).toBe(false);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const request = makeMockRequest(undefined);
    const reply = makeMockReply();

    await authenticate(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "UNAUTHORIZED" }),
      }),
    );
  });

  it("returns 401 when Authorization header is not Bearer", async () => {
    const request = makeMockRequest("Basic abc123");
    const reply = makeMockReply();

    await authenticate(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when token verification fails", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("Token expired"));

    const request = makeMockRequest("Bearer expired-token");
    const reply = makeMockReply();

    await authenticate(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(request.user).toBeUndefined();
  });

  it("defaults to participant role when roles claim is missing", async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: "user-2",
      email: "new@test.com",
      // no roles claim
    });

    const request = makeMockRequest("Bearer valid-token");
    const reply = makeMockReply();

    await authenticate(request, reply);

    expect(request.user?.roles).toEqual(["participant"]);
  });

  it("defaults email to empty string when not in token", async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: "phone-user",
      // no email
    });

    const request = makeMockRequest("Bearer valid-token");
    const reply = makeMockReply();

    await authenticate(request, reply);

    expect(request.user?.email).toBe("");
  });
});

describe("optionalAuth", () => {
  it("sets request.user when valid token is present", async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: "user-1",
      email: "test@test.com",
      email_verified: true,
      roles: ["participant"],
    });

    const request = makeMockRequest("Bearer valid-token");
    const reply = makeMockReply();

    await optionalAuth(request, reply);

    expect(request.user).toBeDefined();
    expect(request.user?.uid).toBe("user-1");
    expect(request.user?.emailVerified).toBe(true);
  });

  it("does not set user when no header is present", async () => {
    const request = makeMockRequest(undefined);
    const reply = makeMockReply();

    await optionalAuth(request, reply);

    expect(request.user).toBeUndefined();
    expect(reply.status).not.toHaveBeenCalled();
  });

  it("treats invalid token as anonymous (no error)", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("Bad token"));

    const request = makeMockRequest("Bearer bad-token");
    const reply = makeMockReply();

    await optionalAuth(request, reply);

    expect(request.user).toBeUndefined();
    expect(reply.status).not.toHaveBeenCalled();
  });
});

describe("requireEmailVerified", () => {
  const verifiedUser: AuthUser = {
    uid: "verified-user",
    email: "verified@test.com",
    roles: ["organizer"] as UserRole[],
    organizationId: "org-1",
    emailVerified: true,
  };

  const unverifiedUser: AuthUser = {
    uid: "unverified-user",
    email: "unverified@test.com",
    roles: ["organizer"] as UserRole[],
    organizationId: "org-1",
    emailVerified: false,
  };

  const superAdminUnverified: AuthUser = {
    uid: "admin-1",
    email: "admin@teranga.sn",
    roles: ["super_admin"] as UserRole[],
    emailVerified: false,
  };

  it("passes through when request.user.emailVerified is true", async () => {
    const request = makeMockRequestWithUser(verifiedUser);
    const reply = makeMockReply();

    await requireEmailVerified(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("returns 403 EMAIL_NOT_VERIFIED when user's email is not verified", async () => {
    const request = makeMockRequestWithUser(unverifiedUser);
    const reply = makeMockReply();

    await requireEmailVerified(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }),
      }),
    );
  });

  it("exempts super_admin even when email is not verified", async () => {
    const request = makeMockRequestWithUser(superAdminUnverified);
    const reply = makeMockReply();

    await requireEmailVerified(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  // PR #163 review — the previous `roles.includes("super_admin")` check
  // produced a correctness gap: `platform:*` subroles (closure C of the
  // admin overhaul) hold `platform:manage` at the service layer and bypass
  // the web-side email gate, but the API middleware was still denying them.
  // This parameterised test locks in parity for every subrole.
  const PLATFORM_ADMIN_ROLES = [
    "platform:super_admin",
    "platform:support",
    "platform:finance",
    "platform:ops",
    "platform:security",
  ] as const;

  for (const role of PLATFORM_ADMIN_ROLES) {
    it(`exempts ${role} even when email is not verified`, async () => {
      const request = makeMockRequestWithUser({
        uid: `user-${role}`,
        email: `${role}@teranga.sn`,
        roles: [role] as UserRole[],
        emailVerified: false,
      });
      const reply = makeMockReply();

      await requireEmailVerified(request, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });
  }

  it("returns 401 UNAUTHORIZED when request.user is missing (authenticate not run first)", async () => {
    const request = makeMockRequest(undefined);
    const reply = makeMockReply();

    await requireEmailVerified(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "UNAUTHORIZED" }),
      }),
    );
  });

  it("does not leak a stack trace — the 403 body carries only the code + message", async () => {
    const request = makeMockRequestWithUser(unverifiedUser);
    const reply = makeMockReply();

    await requireEmailVerified(request, reply);

    const sendArg = (reply.send as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as {
      error: { code: string; message: string; stack?: unknown };
    };
    expect(sendArg.error.code).toBe("EMAIL_NOT_VERIFIED");
    expect(sendArg.error.message).toMatch(/verification/i);
    expect(sendArg.error).not.toHaveProperty("stack");
  });
});
