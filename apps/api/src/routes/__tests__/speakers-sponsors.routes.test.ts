import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { speakerRoutes } from "../speakers.routes";
import { sponsorRoutes } from "../sponsors.routes";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockVerifyIdToken = vi.fn();

vi.mock("@/config/firebase", () => ({
  auth: {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  },
}));

const mockSpeakerService = { updateSpeaker: vi.fn() };
const mockSponsorService = { updateSponsor: vi.fn() };
const mockUploadService = { generateUploadUrl: vi.fn() };

vi.mock("@/services/speaker.service", () => ({
  speakerService: new Proxy(
    {},
    { get: (_t, p) => (mockSpeakerService as Record<string, unknown>)[p as string] },
  ),
}));
vi.mock("@/services/sponsor.service", () => ({
  sponsorService: new Proxy(
    {},
    { get: (_t, p) => (mockSponsorService as Record<string, unknown>)[p as string] },
  ),
}));
vi.mock("@/services/upload.service", () => ({
  uploadService: new Proxy(
    {},
    { get: (_t, p) => (mockUploadService as Record<string, unknown>)[p as string] },
  ),
}));

// ─── App boot ──────────────────────────────────────────────────────────────
//
// Regression guard for the endpoint-drift PR: both frontends called
// PATCH on these two routes while the server only had PUT. These tests
// pin both verbs so if someone refactors back to PUT-only, the drift
// comes back loud instead of silent.

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(speakerRoutes, { prefix: "/v1/events" });
  await app.register(sponsorRoutes, { prefix: "/v1/events" });
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
  mockVerifyIdToken.mockResolvedValue({
    uid: "user-1",
    email: "speaker@example.com",
    email_verified: true,
    roles: ["speaker"],
  });
});

const authHeader = { authorization: "Bearer mock-token" };
const validSpeakerUpdate = { name: "New Name", bio: "Updated bio" };
const validSponsorUpdate = { companyName: "New Corp", boothTitle: "Come visit" };

describe("Speaker update — PATCH + PUT dual verb", () => {
  it("PATCH /events/speakers/:id routes to updateSpeaker", async () => {
    mockSpeakerService.updateSpeaker.mockResolvedValue({
      id: "spk-1",
      name: "New Name",
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/events/speakers/spk-1",
      headers: authHeader,
      payload: validSpeakerUpdate,
    });

    expect(res.statusCode).toBe(200);
    expect(mockSpeakerService.updateSpeaker).toHaveBeenCalledWith(
      "spk-1",
      validSpeakerUpdate,
      expect.any(Object),
    );
  });

  it("PUT /events/speakers/:id still works (alias)", async () => {
    mockSpeakerService.updateSpeaker.mockResolvedValue({
      id: "spk-1",
      name: "New Name",
    });

    const res = await app.inject({
      method: "PUT",
      url: "/v1/events/speakers/spk-1",
      headers: authHeader,
      payload: validSpeakerUpdate,
    });

    expect(res.statusCode).toBe(200);
    expect(mockSpeakerService.updateSpeaker).toHaveBeenCalledWith(
      "spk-1",
      validSpeakerUpdate,
      expect.any(Object),
    );
  });
});

describe("Sponsor update — PATCH + PUT dual verb", () => {
  it("PATCH /events/sponsors/:id routes to updateSponsor", async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: "user-1",
      email: "sponsor@example.com",
      email_verified: true,
      roles: ["sponsor"],
    });
    mockSponsorService.updateSponsor.mockResolvedValue({
      id: "spn-1",
      companyName: "New Corp",
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/events/sponsors/spn-1",
      headers: authHeader,
      payload: validSponsorUpdate,
    });

    expect(res.statusCode).toBe(200);
    expect(mockSponsorService.updateSponsor).toHaveBeenCalledWith(
      "spn-1",
      validSponsorUpdate,
      expect.any(Object),
    );
  });

  it("PUT /events/sponsors/:id still works (alias)", async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: "user-1",
      email: "sponsor@example.com",
      email_verified: true,
      roles: ["sponsor"],
    });
    mockSponsorService.updateSponsor.mockResolvedValue({
      id: "spn-1",
      companyName: "New Corp",
    });

    const res = await app.inject({
      method: "PUT",
      url: "/v1/events/sponsors/spn-1",
      headers: authHeader,
      payload: validSponsorUpdate,
    });

    expect(res.statusCode).toBe(200);
    expect(mockSponsorService.updateSponsor).toHaveBeenCalledWith(
      "spn-1",
      validSponsorUpdate,
      expect.any(Object),
    );
  });
});
