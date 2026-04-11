import { describe, it, expect, vi, beforeEach } from "vitest";
import { type FastifyRequest, type FastifyReply } from "fastify";
import { authenticate, optionalAuth } from "../auth.middleware";

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
    });
    expect(reply.status).not.toHaveBeenCalled();
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
      roles: ["participant"],
    });

    const request = makeMockRequest("Bearer valid-token");
    const reply = makeMockReply();

    await optionalAuth(request, reply);

    expect(request.user).toBeDefined();
    expect(request.user?.uid).toBe("user-1");
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
