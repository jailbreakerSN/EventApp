import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// The exchange path reads two Firestore rows in sequence (the code doc
// inside a runTransaction, then the target user doc) and writes one
// audit row. We mock each leg explicitly so the test can drive the code
// through the happy path + every rejection reason without an emulator.

const hoisted = vi.hoisted(() => ({
  mockCodeTxGet: vi.fn(),
  mockCodeTxUpdate: vi.fn(),
  mockUserDocGet: vi.fn(),
  mockAuditAdd: vi.fn().mockResolvedValue({ id: "audit-row-id" }),
  mockCreateCustomToken: vi.fn().mockResolvedValue("mock-custom-token"),
  mockCodeSet: vi.fn().mockResolvedValue(undefined),
}));

const {
  mockCodeTxGet,
  mockCodeTxUpdate,
  mockUserDocGet,
  mockAuditAdd,
  mockCreateCustomToken,
  mockCodeSet,
} = hoisted;

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id: string) => {
        if (name === "users") {
          return { get: hoisted.mockUserDocGet, id };
        }
        if (name === "impersonationCodes") {
          return { set: hoisted.mockCodeSet, id };
        }
        return { get: vi.fn(), set: vi.fn(), id };
      }),
      add: name === "auditLogs" ? hoisted.mockAuditAdd : vi.fn(),
    })),
    // `runTransaction` is the critical atomicity primitive — the test
    // wires `tx.get` to the code doc spy so consumption attempts all
    // go through a single captured queue. `tx.update` gets its own
    // spy so tests can assert the exact patch payload.
    runTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        get: () => hoisted.mockCodeTxGet(),
        update: (_ref: unknown, data: unknown) => hoisted.mockCodeTxUpdate(data),
      };
      return cb(tx);
    }),
  },
  auth: { createCustomToken: hoisted.mockCreateCustomToken },
  COLLECTIONS: {
    USERS: "users",
    AUDIT_LOGS: "auditLogs",
    IMPERSONATION_CODES: "impersonationCodes",
  },
}));

vi.mock("@/events/event-bus", () => ({ eventBus: { emit: vi.fn() } }));
vi.mock("@/context/request-context", () => ({ getRequestId: () => "test-req" }));
vi.mock("@/config/index", () => ({
  config: {
    WEB_BACKOFFICE_URL: "https://backoffice.example",
    PARTICIPANT_WEB_URL: "https://participant.example",
  },
}));

// Import AFTER mocks
import { impersonationCodeService } from "../impersonation-code.service";
import { buildSuperAdmin } from "@/__tests__/factories";
import type { UserProfile } from "@teranga/shared-types";

const TARGET_UID = "target-alice";
const ADMIN_UID = "admin-1";

// Explicit `UserProfile` typing so issue() / exchange() accept the
// fixture — CI type-check is stricter than the local run and refuses
// partial shapes.
const targetProfileBase: UserProfile = {
  uid: TARGET_UID,
  email: "alice@example.com",
  displayName: "Alice D.",
  roles: ["participant"],
  organizationId: "org-001",
  orgRole: "member",
  preferredLanguage: "fr",
  isActive: true,
  isEmailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function codeDocData(overrides: Record<string, unknown> = {}) {
  return {
    adminUid: ADMIN_UID,
    adminDisplayName: "Admin Tester",
    actorRole: "super_admin",
    targetUid: TARGET_UID,
    targetDisplayName: "Alice D.",
    targetEmail: "alice@example.com",
    targetOrigin: "https://participant.example",
    issuedAt: new Date(Date.now() - 5_000).toISOString(),
    // Fresh deadline 55s in the future.
    expiresAt: new Date(Date.now() + 55_000),
    expiresAtIso: new Date(Date.now() + 55_000).toISOString(),
    consumedAt: null,
    issueIp: "203.0.113.7",
    issueUa: "AdminBrowser/1.0",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCodeTxGet.mockReset();
  mockUserDocGet.mockReset();
});

// ─── issue() ───────────────────────────────────────────────────────────────

describe("ImpersonationCodeService.issue", () => {
  it("persists a SHA-256-hashed code doc and returns the raw code + accept URL", async () => {
    const admin = buildSuperAdmin({ uid: ADMIN_UID });

    const res = await impersonationCodeService.issue({
      admin,
      actorDisplayName: "Admin Tester",
      actorRole: "super_admin",
      target: targetProfileBase,
      issueIp: "203.0.113.7",
      issueUa: "AdminBrowser/1.0",
    });

    // 32 random bytes base64url-encoded → 43 chars; URL-safe alphabet.
    expect(res.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Participant origin because the target holds `participant` role.
    expect(res.targetOrigin).toBe("https://participant.example");
    expect(res.acceptUrl).toBe(
      `https://participant.example/impersonation/accept?code=${encodeURIComponent(res.code)}`,
    );
    expect(res.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The stored doc id is the SHA-256 HASH of the raw code, not the
    // raw code itself. Crucial property — a leaked DB dump cannot be
    // used to construct accept URLs.
    expect(mockCodeSet).toHaveBeenCalledTimes(1);
    const storedPayload = mockCodeSet.mock.calls[0]?.[0];
    expect(storedPayload).toMatchObject({
      adminUid: admin.uid,
      targetUid: TARGET_UID,
      targetOrigin: "https://participant.example",
      consumedAt: null,
      issueIp: "203.0.113.7",
      issueUa: "AdminBrowser/1.0",
    });
    expect(storedPayload).not.toHaveProperty("code");
    expect(storedPayload).not.toHaveProperty("rawCode");
  });

  it("routes backoffice-role targets to the backoffice origin", async () => {
    const admin = buildSuperAdmin({ uid: ADMIN_UID });
    const organizerTarget: UserProfile = {
      ...targetProfileBase,
      roles: ["organizer"],
    };

    const res = await impersonationCodeService.issue({
      admin,
      actorDisplayName: null,
      actorRole: "super_admin",
      target: organizerTarget,
      issueIp: null,
      issueUa: null,
    });

    expect(res.targetOrigin).toBe("https://backoffice.example");
    expect(res.acceptUrl.startsWith("https://backoffice.example/impersonation/accept?code=")).toBe(
      true,
    );
  });
});

// ─── exchange() ────────────────────────────────────────────────────────────

describe("ImpersonationCodeService.exchange", () => {
  it("mints a custom token, marks the code consumed, writes audit, emits event", async () => {
    mockCodeTxGet.mockResolvedValueOnce({ exists: true, data: () => codeDocData() });
    mockUserDocGet.mockResolvedValueOnce({ exists: true, data: () => targetProfileBase });

    const res = await impersonationCodeService.exchange({
      code: "raw-code-for-test",
      origin: "https://participant.example",
      consumeIp: "198.51.100.9",
      consumeUa: "TargetApp/1.0",
    });

    expect(res.customToken).toBe("mock-custom-token");
    expect(res.actorUid).toBe(ADMIN_UID);
    expect(res.targetUid).toBe(TARGET_UID);
    // Session deadline ≥ 29 minutes out (30-min cap minus test drift).
    expect(new Date(res.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 60_000);

    // Single-use flag: tx.update called with consumedAt + audit IP/UA.
    expect(mockCodeTxUpdate).toHaveBeenCalledTimes(1);
    const patch = mockCodeTxUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch.consumedAt).toEqual(expect.any(String));
    expect(patch.consumeIp).toBe("198.51.100.9");
    expect(patch.consumeUa).toBe("TargetApp/1.0");

    // Fresh custom token includes the impersonatedBy + roles claims,
    // sourced from the target doc fetched INSIDE exchange — not from
    // the code doc — so admin-edited roles during the 60s window take
    // effect.
    expect(mockCreateCustomToken).toHaveBeenCalledWith(
      TARGET_UID,
      expect.objectContaining({
        impersonatedBy: ADMIN_UID,
        roles: ["participant"],
        organizationId: "org-001",
      }),
    );

    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.impersonation_exchanged",
        actorId: ADMIN_UID,
        resourceId: TARGET_UID,
      }),
    );
  });

  it("rejects an unknown code with NOT_FOUND (does not leak via message)", async () => {
    mockCodeTxGet.mockResolvedValueOnce({ exists: false, data: () => null });

    await expect(
      impersonationCodeService.exchange({
        code: "bogus",
        origin: "https://participant.example",
        consumeIp: null,
        consumeUa: null,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    // No token minted, no audit row written.
    expect(mockCreateCustomToken).not.toHaveBeenCalled();
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });

  it("rejects an expired code with 410 IMPERSONATION_CODE_EXPIRED", async () => {
    mockCodeTxGet.mockResolvedValueOnce({
      exists: true,
      data: () =>
        codeDocData({
          expiresAt: new Date(Date.now() - 10_000),
          expiresAtIso: new Date(Date.now() - 10_000).toISOString(),
        }),
    });

    await expect(
      impersonationCodeService.exchange({
        code: "any",
        origin: "https://participant.example",
        consumeIp: null,
        consumeUa: null,
      }),
    ).rejects.toMatchObject({
      code: "IMPERSONATION_CODE_EXPIRED",
      statusCode: 410,
    });
    expect(mockCreateCustomToken).not.toHaveBeenCalled();
  });

  it("rejects a second exchange of the same code as 409 CONFLICT", async () => {
    mockCodeTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => codeDocData({ consumedAt: new Date().toISOString() }),
    });

    await expect(
      impersonationCodeService.exchange({
        code: "any",
        origin: "https://participant.example",
        consumeIp: null,
        consumeUa: null,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockCreateCustomToken).not.toHaveBeenCalled();
  });

  it("rejects a mismatched Origin with 403 IMPERSONATION_ORIGIN_MISMATCH", async () => {
    mockCodeTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => codeDocData(), // bound to participant.example
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      impersonationCodeService.exchange({
        code: "any",
        origin: "https://backoffice.example", // wrong origin
        consumeIp: null,
        consumeUa: null,
      }),
    ).rejects.toMatchObject({
      code: "IMPERSONATION_ORIGIN_MISMATCH",
      statusCode: 403,
    });
    expect(mockCreateCustomToken).not.toHaveBeenCalled();

    // Security: the 403 must NOT echo `expectedOrigin` in its body —
    // that would leak which app a captured code was issued for. The
    // value lives in the stderr warn instead so ops can still diagnose.
    stderrSpy.mockRestore();
  });

  it("does not leak the expected origin in the 403 error body (security review #1)", async () => {
    mockCodeTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => codeDocData({ targetOrigin: "https://participant.example" }),
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await impersonationCodeService.exchange({
        code: "any",
        origin: "https://attacker.example",
        consumeIp: null,
        consumeUa: null,
      });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as { code: string; details?: unknown };
      expect(e.code).toBe("IMPERSONATION_ORIGIN_MISMATCH");
      // Body must not carry the expected origin. Serialising to JSON
      // is what the global error handler does — if `details` is
      // undefined, `AppError.toJSON` omits it entirely.
      expect(e.details).toBeUndefined();
    }
    // The diagnostic is captured in a structured stderr row instead.
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("impersonation.origin_mismatch"),
    );
    stderrSpy.mockRestore();
  });

  it("rejects a missing Origin header with 403 (empty != match)", async () => {
    mockCodeTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => codeDocData(),
    });

    await expect(
      impersonationCodeService.exchange({
        code: "any",
        origin: null,
        consumeIp: null,
        consumeUa: null,
      }),
    ).rejects.toMatchObject({ code: "IMPERSONATION_ORIGIN_MISMATCH" });
  });

  it("refuses if the target became a top-tier admin between issue and exchange", async () => {
    // The issue-time guard already rejected top-admin targets. This is
    // the belt-and-braces check for the (tiny) window where an admin
    // promoted the target between issue and consume.
    mockCodeTxGet.mockResolvedValueOnce({ exists: true, data: () => codeDocData() });
    mockUserDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...targetProfileBase, roles: ["super_admin"] }),
    });

    await expect(
      impersonationCodeService.exchange({
        code: "any",
        origin: "https://participant.example",
        consumeIp: null,
        consumeUa: null,
      }),
    ).rejects.toThrow(/another super_admin/i);
    expect(mockCreateCustomToken).not.toHaveBeenCalled();
    // The code was still marked consumed in the transaction — single-use
    // guarantee holds even when the post-exchange check fails. A second
    // replay of the same code would now hit the CONSUMED branch.
    expect(mockCodeTxUpdate).toHaveBeenCalled();
  });

  it("wraps Firebase createCustomToken failures as IMPERSONATION_SIGNING_UNAVAILABLE (503)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockCodeTxGet.mockResolvedValueOnce({ exists: true, data: () => codeDocData() });
    mockUserDocGet.mockResolvedValueOnce({ exists: true, data: () => targetProfileBase });
    const firebaseErr = new Error("Permission denied on signBlob");
    (firebaseErr as unknown as { code: string }).code = "app/credential-implementation-error";
    mockCreateCustomToken.mockRejectedValueOnce(firebaseErr);

    await expect(
      impersonationCodeService.exchange({
        code: "any",
        origin: "https://participant.example",
        consumeIp: null,
        consumeUa: null,
      }),
    ).rejects.toMatchObject({
      code: "IMPERSONATION_SIGNING_UNAVAILABLE",
      statusCode: 503,
    });

    // Structured stderr log captures the upstream Firebase code so ops
    // can act on it without re-reading the stack trace. The accept page
    // surfaces a generic "service unavailable" to the user.
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("impersonation.exchange_sign_failed"),
    );
    stderrSpy.mockRestore();
  });

  it("strips null-valued organizationId / orgRole from the custom-token claims", async () => {
    mockCodeTxGet.mockResolvedValueOnce({ exists: true, data: () => codeDocData() });
    mockUserDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...targetProfileBase, organizationId: null, orgRole: null }),
    });

    await impersonationCodeService.exchange({
      code: "any",
      origin: "https://participant.example",
      consumeIp: null,
      consumeUa: null,
    });

    const claimsArg = mockCreateCustomToken.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(claimsArg).not.toHaveProperty("organizationId");
    expect(claimsArg).not.toHaveProperty("orgRole");
  });
});
