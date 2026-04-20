import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { inviteRoutes } from "../invites.routes";
import { AppError } from "@/errors/app-error";

// ─── Invite accept / decline route coverage ────────────────────────────────
// Invites are the only supported path to add a new member to an
// organization outside of platform-admin tooling. A regression here
// either locks out legitimate teammates or — worse — lets an
// unauthenticated / unverified caller claim an invite token.
//
// Covered at route level: auth chain, email-verification gate, body
// validation, and the invariant that the service call receives the
// (token, user) pair verbatim.

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
}));

const mockInviteService = {
  acceptInvite: vi.fn(),
  declineInvite: vi.fn(),
};

vi.mock("@/services/invite.service", () => ({
  inviteService: new Proxy(
    {},
    {
      get: (_t, p) => (mockInviteService as Record<string, unknown>)[p as string],
    },
  ),
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(inviteRoutes, { prefix: "/v1/invites" });
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
  mockVerifyIdToken.mockResolvedValue({
    uid: "new-member-1",
    email: "teammate@example.com",
    email_verified: true,
    roles: ["participant"],
  });
});

const authHeader = { authorization: "Bearer mock-token" };

describe("POST /v1/invites/accept", () => {
  it("401 when no auth header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      payload: { token: "tok-123" },
    });
    expect(res.statusCode).toBe(401);
    expect(mockInviteService.acceptInvite).not.toHaveBeenCalled();
  });

  it("403 when email is not verified (email gate blocks the claim)", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "new-member-1",
      email: "teammate@example.com",
      email_verified: false,
      roles: ["participant"],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      headers: authHeader,
      payload: { token: "tok-123" },
    });
    expect(res.statusCode).toBe(403);
    expect(mockInviteService.acceptInvite).not.toHaveBeenCalled();
  });

  it("400 when token is missing from body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      headers: authHeader,
      payload: {}, // no token
    });
    expect(res.statusCode).toBe(400);
    expect(mockInviteService.acceptInvite).not.toHaveBeenCalled();
  });

  it("200 forwards (token, user) verbatim to the service", async () => {
    mockInviteService.acceptInvite.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      headers: authHeader,
      payload: { token: "tok-123" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockInviteService.acceptInvite).toHaveBeenCalledWith(
      "tok-123",
      expect.objectContaining({ uid: "new-member-1" }),
    );
    expect(JSON.parse(res.body)).toEqual({ success: true, data: null });
  });
});

describe("POST /v1/invites/decline", () => {
  it("401 when no auth header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/decline",
      payload: { token: "tok-123" },
    });
    expect(res.statusCode).toBe(401);
    expect(mockInviteService.declineInvite).not.toHaveBeenCalled();
  });

  it("200 forwards (token, user) verbatim to the service", async () => {
    mockInviteService.declineInvite.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/v1/invites/decline",
      headers: authHeader,
      payload: { token: "tok-xyz" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockInviteService.declineInvite).toHaveBeenCalledWith(
      "tok-xyz",
      expect.objectContaining({ uid: "new-member-1" }),
    );
  });
});
