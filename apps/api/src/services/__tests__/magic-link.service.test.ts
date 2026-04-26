import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/errors/app-error";
import { buildAuthUser, buildOrganizerUser } from "@/__tests__/factories";
import type { MagicLink } from "@teranga/shared-types";

// ─── Magic-link signing primitive ─────────────────────────────────────────
//
// The HMAC sign + parse layer is pure and central to the security
// model. We pin every branch: round-trip, tamper detection,
// expired-but-still-valid-signature (parser still returns the payload
// — expiry check happens at the service-level), shape constraints.
//
// We set a stable `QR_SECRET` for the test run; the service reads it
// at call time so we can override.

const ORIGINAL_SECRET = process.env.QR_SECRET;

interface DocStub {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

const hoisted = vi.hoisted(() => ({
  storedDoc: null as DocStub | null,
  setMock: vi.fn(),
  updateMock: vi.fn(),
  emitMock: vi.fn(),
  // Configurable plan for the speakerPortal / sponsorPortal gate.
  // Default `pro` so happy-path tests don't need to opt-in.
  orgPlan: "pro" as "free" | "starter" | "pro" | "enterprise",
}));

function setStoredDoc(value: typeof hoisted.storedDoc): void {
  hoisted.storedDoc = value;
}

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn((id?: string) => ({
        id: id ?? "doc-id",
        get: async () => hoisted.storedDoc ?? { exists: false, data: () => undefined },
        set: hoisted.setMock,
        update: hoisted.updateMock,
      })),
    })),
  },
  COLLECTIONS: { MAGIC_LINKS: "magicLinks" },
}));

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: {
    findByIdOrThrow: vi.fn(async (id: string) => ({
      id,
      organizationId: "org-1",
      status: "published",
    })),
  },
}));

// O10 plan-gate: issue() now requires `speakerPortal` / `sponsorPortal`
// (pro+). The plan is configurable via `hoisted.orgPlan` so the
// PlanLimitError test below can flip it to `free`. Default = `pro`
// for the happy paths.
vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: {
    findByIdOrThrow: vi.fn(async (id: string) => ({
      id,
      plan: hoisted.orgPlan,
    })),
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: hoisted.emitMock },
}));

vi.mock("@/context/request-context", () => ({
  getRequestContext: () => ({ requestId: "test-request-id" }),
  getRequestId: () => "test-request-id",
  trackFirestoreReads: vi.fn(),
}));

beforeEach(() => {
  process.env.QR_SECRET = "test-secret-1234567890abcdef";
  vi.clearAllMocks();
  setStoredDoc(null);
  hoisted.orgPlan = "pro";
});

afterEach(() => {
  process.env.QR_SECRET = ORIGINAL_SECRET;
});

// vi.mock factories above are hoisted before these imports by vitest
// at compile time, so the service binds to the mocked modules.
import { signToken, parseToken, hashToken, magicLinkService } from "../magic-link.service";

describe("signToken / parseToken — round-trip", () => {
  it("emits a 6-part dot-delimited string starting with v1.", () => {
    const token = signToken({
      role: "speaker",
      resourceId: "spk-1",
      eventId: "evt-1",
      expiresAt: new Date("2026-04-30T10:00:00.000Z"),
    });
    const parts = token.split(".");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("v1");
    expect(parts[1]).toBe("speaker");
    expect(parts[2]).toBe("spk-1");
    expect(parts[3]).toBe("evt-1");
    // Full 64 hex char HMAC-SHA256 signature — no truncation
    // (CLAUDE.md Security Hardening Checklist).
    expect(parts[5]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trips back to the original payload", () => {
    const expiresAt = new Date("2026-04-30T10:00:00.000Z");
    const token = signToken({
      role: "speaker",
      resourceId: "spk-7",
      eventId: "evt-9",
      expiresAt,
    });
    const parsed = parseToken(token);
    expect(parsed?.role).toBe("speaker");
    expect(parsed?.resourceId).toBe("spk-7");
    expect(parsed?.eventId).toBe("evt-9");
    expect(parsed?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it("rejects tokens with a tampered signature (constant-time compare)", () => {
    const token = signToken({
      role: "sponsor",
      resourceId: "spn-1",
      eventId: "evt-1",
      expiresAt: new Date("2026-04-30T10:00:00.000Z"),
    });
    // Replace the full 64-char HMAC with zeros — signature mismatch.
    const tampered = token.slice(0, -64) + "0".repeat(64);
    expect(parseToken(tampered)).toBeNull();
  });

  it("rejects tokens with a tampered resourceId (HMAC catches it)", () => {
    const token = signToken({
      role: "speaker",
      resourceId: "spk-1",
      eventId: "evt-1",
      expiresAt: new Date("2026-04-30T10:00:00.000Z"),
    });
    const parts = token.split(".");
    parts[2] = "spk-2"; // swap resourceId — sig no longer matches
    expect(parseToken(parts.join("."))).toBeNull();
  });

  it("rejects tokens with the wrong version prefix", () => {
    const token = signToken({
      role: "speaker",
      resourceId: "spk-1",
      eventId: "evt-1",
      expiresAt: new Date("2026-04-30T10:00:00.000Z"),
    });
    expect(parseToken("v2" + token.slice(2))).toBeNull();
  });

  it("rejects tokens with an unknown role", () => {
    // 64-char hex sig (the role check rejects this before the sig
    // compare runs, but the length must match for the format guard).
    expect(parseToken(`v1.admin.spk-1.evt-1.lqxqz.${"0".repeat(64)}`)).toBeNull();
  });

  it("rejects tokens shorter than 6 parts", () => {
    expect(parseToken("v1.speaker.spk-1.evt-1.lqxqz")).toBeNull();
  });

  it("rejects empty / overly long input safely", () => {
    expect(parseToken("")).toBeNull();
    expect(parseToken("a".repeat(2000))).toBeNull();
  });

  it("does NOT reject expired tokens at the parse layer (expiry is enforced by the service)", () => {
    const past = new Date(Date.now() - 60_000);
    const token = signToken({
      role: "speaker",
      resourceId: "spk-1",
      eventId: "evt-1",
      expiresAt: past,
    });
    const parsed = parseToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed!.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it("rejects tokens signed with a different secret", () => {
    const token = signToken({
      role: "speaker",
      resourceId: "spk-1",
      eventId: "evt-1",
      expiresAt: new Date("2026-04-30T10:00:00.000Z"),
    });
    process.env.QR_SECRET = "different-secret-abcdef0123456789";
    expect(parseToken(token)).toBeNull();
  });
});

describe("hashToken", () => {
  it("returns a stable SHA-256 hex digest", () => {
    const a = hashToken("hello");
    const b = hashToken("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hashes for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

// ─── Service integration — issue / verify / revoke ────────────────────────

function makeStoredRecord(over: Partial<MagicLink> = {}): MagicLink {
  return {
    id: "hash-1",
    role: "speaker",
    resourceId: "spk-1",
    eventId: "evt-1",
    organizationId: "org-1",
    recipientEmail: "speaker@example.com",
    createdBy: "u-org",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    firstUsedAt: null,
    revokedAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("magicLinkService.issue", () => {
  it("persists the record + emits magic_link.issued (happy path)", async () => {
    const user = buildOrganizerUser("org-1");
    const result = await magicLinkService.issue(
      {
        role: "speaker",
        resourceId: "spk-1",
        eventId: "evt-1",
        recipientEmail: "Speaker@Example.com",
        ttlHours: 48,
      },
      user,
    );

    // The plaintext token round-trips through parse.
    const parsed = parseToken(result.token);
    expect(parsed?.role).toBe("speaker");
    expect(parsed?.resourceId).toBe("spk-1");

    // Persist via Firestore set.
    expect(hoisted.setMock).toHaveBeenCalledTimes(1);

    // Email is normalised to lower-case on the persisted record.
    expect(result.record.recipientEmail).toBe("speaker@example.com");

    // Privacy: the audit emit MUST NOT carry recipientEmail —
    // forensic lookup goes via the Firestore doc keyed on tokenHash.
    expect(hoisted.emitMock).toHaveBeenCalledWith(
      "magic_link.issued",
      expect.objectContaining({
        role: "speaker",
        eventId: "evt-1",
        organizationId: "org-1",
      }),
    );
    const issuedCall = hoisted.emitMock.mock.calls.find((c) => c[0] === "magic_link.issued");
    expect(issuedCall![1]).not.toHaveProperty("recipientEmail");
  });

  it("rejects callers without event:update (permission denial)", async () => {
    const participant = buildAuthUser({ roles: ["participant"], organizationId: "org-1" });
    await expect(
      magicLinkService.issue(
        {
          role: "speaker",
          resourceId: "spk-1",
          eventId: "evt-1",
          recipientEmail: "x@example.com",
        },
        participant,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(hoisted.setMock).not.toHaveBeenCalled();
  });

  it("rejects callers from another organisation", async () => {
    const otherOrg = buildOrganizerUser("org-2");
    await expect(
      magicLinkService.issue(
        {
          role: "speaker",
          resourceId: "spk-1",
          eventId: "evt-1",
          recipientEmail: "x@example.com",
        },
        otherOrg,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(hoisted.setMock).not.toHaveBeenCalled();
  });

  it("throws PlanLimitError on a free-plan org for role=speaker (speakerPortal gate)", async () => {
    const { PlanLimitError } = await import("@/errors/app-error");
    hoisted.orgPlan = "free";
    const user = buildOrganizerUser("org-1");
    await expect(
      magicLinkService.issue(
        {
          role: "speaker",
          resourceId: "spk-1",
          eventId: "evt-1",
          recipientEmail: "x@example.com",
        },
        user,
      ),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(hoisted.setMock).not.toHaveBeenCalled();
  });

  it("throws PlanLimitError on a free-plan org for role=sponsor (sponsorPortal gate)", async () => {
    const { PlanLimitError } = await import("@/errors/app-error");
    hoisted.orgPlan = "free";
    const user = buildOrganizerUser("org-1");
    await expect(
      magicLinkService.issue(
        {
          role: "sponsor",
          resourceId: "spn-1",
          eventId: "evt-1",
          recipientEmail: "x@example.com",
        },
        user,
      ),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(hoisted.setMock).not.toHaveBeenCalled();
  });
});

describe("magicLinkService.verify", () => {
  it("returns the scope + stamps firstUsedAt + emits magic_link.used (happy path)", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const token = signToken({
      role: "speaker",
      resourceId: "spk-1",
      eventId: "evt-1",
      expiresAt,
    });
    setStoredDoc({
      exists: true,
      data: () =>
        makeStoredRecord({
          id: hashToken(token),
          expiresAt: expiresAt.toISOString(),
        }),
    });

    const out = await magicLinkService.verify(token);
    expect(out.role).toBe("speaker");
    expect(out.resourceId).toBe("spk-1");
    expect(out.eventId).toBe("evt-1");
    expect(out.organizationId).toBe("org-1");

    // firstUsedAt stamped via update.
    expect(hoisted.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ firstUsedAt: expect.any(String) }),
    );
    expect(hoisted.emitMock).toHaveBeenCalledWith(
      "magic_link.used",
      expect.objectContaining({ role: "speaker", resourceId: "spk-1" }),
    );
  });

  it("rejects malformed tokens with ValidationError", async () => {
    await expect(magicLinkService.verify("not-a-real-token")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects expired tokens with ForbiddenError", async () => {
    const past = new Date(Date.now() - 60_000);
    const token = signToken({
      role: "speaker",
      resourceId: "spk-1",
      eventId: "evt-1",
      expiresAt: past,
    });
    await expect(magicLinkService.verify(token)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects revoked tokens with ForbiddenError", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const token = signToken({
      role: "speaker",
      resourceId: "spk-1",
      eventId: "evt-1",
      expiresAt,
    });
    setStoredDoc({
      exists: true,
      data: () =>
        makeStoredRecord({
          id: hashToken(token),
          expiresAt: expiresAt.toISOString(),
          revokedAt: new Date().toISOString(),
        }),
    });
    await expect(magicLinkService.verify(token)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("404s when the token hash is not found in Firestore", async () => {
    const token = signToken({
      role: "speaker",
      resourceId: "spk-1",
      eventId: "evt-1",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    setStoredDoc(null);
    await expect(magicLinkService.verify(token)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does NOT re-emit magic_link.used on subsequent verifications", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const token = signToken({
      role: "speaker",
      resourceId: "spk-1",
      eventId: "evt-1",
      expiresAt,
    });
    setStoredDoc({
      exists: true,
      data: () =>
        makeStoredRecord({
          id: hashToken(token),
          expiresAt: expiresAt.toISOString(),
          firstUsedAt: new Date(Date.now() - 60_000).toISOString(),
        }),
    });
    await magicLinkService.verify(token);
    expect(hoisted.updateMock).not.toHaveBeenCalled();
    expect(hoisted.emitMock).not.toHaveBeenCalledWith("magic_link.used", expect.anything());
  });
});

describe("magicLinkService.revoke", () => {
  it("flips revokedAt + emits magic_link.revoked (happy path)", async () => {
    setStoredDoc({ exists: true, data: () => makeStoredRecord() });
    const user = buildOrganizerUser("org-1");
    const out = await magicLinkService.revoke("hash-1", user);
    expect(out.revokedAt).not.toBeNull();
    expect(hoisted.setMock).toHaveBeenCalledTimes(1);
    expect(hoisted.emitMock).toHaveBeenCalledWith(
      "magic_link.revoked",
      expect.objectContaining({ tokenHash: "hash-1", role: "speaker" }),
    );
  });

  it("is idempotent: re-revoking returns the existing record without re-writing", async () => {
    setStoredDoc({
      exists: true,
      data: () => makeStoredRecord({ revokedAt: "2026-04-26T10:00:00.000Z" }),
    });
    const user = buildOrganizerUser("org-1");
    const out = await magicLinkService.revoke("hash-1", user);
    expect(out.revokedAt).toBe("2026-04-26T10:00:00.000Z");
    expect(hoisted.setMock).not.toHaveBeenCalled();
    expect(hoisted.emitMock).not.toHaveBeenCalledWith("magic_link.revoked", expect.anything());
  });

  it("404s when the tokenHash is not found", async () => {
    setStoredDoc(null);
    const user = buildOrganizerUser("org-1");
    await expect(magicLinkService.revoke("hash-1", user)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects callers without event:update (permission denial)", async () => {
    const participant = buildAuthUser({
      roles: ["participant"],
      organizationId: "org-1",
    });
    await expect(magicLinkService.revoke("hash-1", participant)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("rejects callers from another organisation", async () => {
    setStoredDoc({ exists: true, data: () => makeStoredRecord({ organizationId: "org-1" }) });
    const otherOrg = buildOrganizerUser("org-2");
    await expect(magicLinkService.revoke("hash-1", otherOrg)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
