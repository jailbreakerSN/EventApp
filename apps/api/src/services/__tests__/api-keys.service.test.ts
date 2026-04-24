import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAuthUser, buildOrgWithPlan } from "@/__tests__/factories";
import { ForbiddenError, NotFoundError, PlanLimitError } from "@/errors/app-error";

/**
 * T2.3 — ApiKeysService unit tests.
 *
 * We mock the repository + Firestore + event bus to isolate the pure
 * service logic (crypto + state machine). The crypto itself uses the
 * real Node `crypto` module because (a) it's cheap and (b) we want
 * tests to catch regressions in the key format.
 */

const hoisted = vi.hoisted(() => ({
  mockListByOrg: vi.fn(),
  mockCountActive: vi.fn().mockResolvedValue(0),
  mockFindById: vi.fn(),
  mockRecordUsage: vi.fn().mockResolvedValue(undefined),
  mockOrgFindByIdOrThrow: vi.fn(),
  mockBusEmit: vi.fn(),
  mockDocCreate: vi.fn().mockResolvedValue(undefined),
  mockDocUpdate: vi.fn().mockResolvedValue(undefined),
  mockDocGet: vi.fn(),
  mockTxGet: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockTxCreate: vi.fn(),
}));

vi.mock("@/repositories/api-keys.repository", () => ({
  apiKeysRepository: {
    listByOrganization: hoisted.mockListByOrg,
    countActive: hoisted.mockCountActive,
    findById: hoisted.mockFindById,
    recordUsage: hoisted.mockRecordUsage,
  },
}));

vi.mock("@/repositories/organization.repository", () => ({
  organizationRepository: {
    findByIdOrThrow: hoisted.mockOrgFindByIdOrThrow,
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: hoisted.mockBusEmit },
}));

vi.mock("@/context/request-context", () => ({
  getRequestContext: () => ({
    requestId: "req-test-1",
    userId: "admin-1",
    startTime: Date.now(),
  }),
}));

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn((_name: string) => ({
      doc: vi.fn((id?: string) => ({
        id: id ?? "new-id",
        create: hoisted.mockDocCreate,
        update: hoisted.mockDocUpdate,
        get: hoisted.mockDocGet,
      })),
    })),
    runTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        get: hoisted.mockTxGet,
        update: hoisted.mockTxUpdate,
        create: hoisted.mockTxCreate,
      };
      return cb(tx);
    }),
  },
  COLLECTIONS: {
    API_KEYS: "apiKeys",
  },
}));

vi.mock("@/config", () => ({
  config: {
    API_KEY_CHECKSUM_SECRET: "test-checksum-secret-for-unit-tests-aaaa",
    API_KEY_AUTH_DISABLED: false,
    NODE_ENV: "test",
  },
}));

// Import AFTER mocks.
import { apiKeysService, parseApiKey } from "../api-keys.service";

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.mockCountActive.mockResolvedValue(0);
  hoisted.mockDocCreate.mockResolvedValue(undefined);
  hoisted.mockDocUpdate.mockResolvedValue(undefined);
  hoisted.mockRecordUsage.mockResolvedValue(undefined);
});

// ─── Format / parse ────────────────────────────────────────────────────────

describe("parseApiKey", () => {
  it("rejects anything without the terk_ prefix", () => {
    expect(parseApiKey("foo")).toBeNull();
    expect(parseApiKey("")).toBeNull();
    expect(parseApiKey("sk_live_abcdef")).toBeNull();
  });

  it("rejects wrong segment count", () => {
    expect(parseApiKey("terk_live_abcdef")).toBeNull(); // missing checksum
    expect(parseApiKey("terk_live_abcdef_xxxx_extra")).toBeNull();
  });

  it("rejects unknown environment", () => {
    const body = "0123456789012345678901234567890123456789";
    expect(parseApiKey(`terk_prod_${body}_abcd`)).toBeNull();
  });

  it("rejects bodies of wrong length", () => {
    expect(parseApiKey("terk_live_short_abcd")).toBeNull();
  });

  it("rejects wrong checksum", () => {
    const body = "0123456789012345678901234567890123456789";
    expect(parseApiKey(`terk_live_${body}_0000`)).toBeNull();
  });

  it("accepts a well-formed key and exposes the hashPrefix", async () => {
    // Force the service to mint a key we can then parse — round-trip.
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );

    const { plaintext } = await apiKeysService.issue(admin, "org-1", {
      name: "test-key",
      scopes: ["event:read"],
      environment: "live",
    });

    const parsed = parseApiKey(plaintext);
    expect(parsed).not.toBeNull();
    expect(parsed!.env).toBe("live");
    expect(parsed!.body.length).toBe(40);
    expect(parsed!.checksum.length).toBe(4);
    expect(parsed!.hashPrefix.length).toBe(10);
    // hashPrefix must match first 10 chars of body (doc-id convention).
    expect(parsed!.hashPrefix).toBe(parsed!.body.slice(0, 10));
  });
});

// ─── issue ─────────────────────────────────────────────────────────────────

describe("ApiKeysService.issue", () => {
  it("mints a key for an enterprise org + emits api_key.created", async () => {
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );

    const result = await apiKeysService.issue(admin, "org-1", {
      name: "Scanner #1",
      scopes: ["checkin:scan"],
      environment: "live",
    });

    expect(result.plaintext).toMatch(/^terk_live_[0-9A-Za-z]{40}_[0-9A-Za-z]{4}$/);
    expect(result.apiKey.status).toBe("active");
    expect(result.apiKey.organizationId).toBe("org-1");
    expect(result.apiKey.scopes).toEqual(["checkin:scan"]);
    expect(result.apiKey.keyHash).toHaveLength(64);
    expect(hoisted.mockDocCreate).toHaveBeenCalledTimes(1);
    expect(hoisted.mockBusEmit).toHaveBeenCalledWith(
      "api_key.created",
      expect.objectContaining({
        apiKeyId: result.apiKey.id,
        organizationId: "org-1",
        scopes: ["checkin:scan"],
      }),
    );
  });

  it("refuses to issue a key for a free-plan org (PlanLimitError)", async () => {
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(buildOrgWithPlan("free", { id: "org-1" }));

    await expect(
      apiKeysService.issue(admin, "org-1", {
        name: "test",
        scopes: ["event:read"],
        environment: "live",
      }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(hoisted.mockDocCreate).not.toHaveBeenCalled();
  });

  it("refuses to issue for a different org (ForbiddenError)", async () => {
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });

    await expect(
      apiKeysService.issue(admin, "org-2", {
        name: "test",
        scopes: ["event:read"],
        environment: "live",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to issue for a participant-role user (Forbidden)", async () => {
    const admin = buildAuthUser({
      uid: "user-1",
      organizationId: "org-1",
      roles: ["participant"],
    });
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );

    await expect(
      apiKeysService.issue(admin, "org-1", {
        name: "test",
        scopes: ["event:read"],
        environment: "live",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ─── revoke ────────────────────────────────────────────────────────────────

describe("ApiKeysService.revoke", () => {
  it("flips status to revoked and emits api_key.revoked", async () => {
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    hoisted.mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        id: "abcdef1234",
        organizationId: "org-1",
        status: "active",
        name: "test",
        scopes: ["event:read"],
        environment: "live",
      }),
    });

    const revoked = await apiKeysService.revoke(admin, "org-1", "abcdef1234", "leaked");

    expect(revoked.status).toBe("revoked");
    expect(revoked.revocationReason).toBe("leaked");
    expect(hoisted.mockTxUpdate).toHaveBeenCalled();
    expect(hoisted.mockBusEmit).toHaveBeenCalledWith(
      "api_key.revoked",
      expect.objectContaining({
        apiKeyId: "abcdef1234",
        reason: "leaked",
      }),
    );
  });

  it("is idempotent on a revoke of an already-revoked key", async () => {
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    hoisted.mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        id: "abcdef1234",
        organizationId: "org-1",
        status: "revoked",
        revokedAt: "2026-01-01T00:00:00.000Z",
        revokedBy: "admin-0",
        revocationReason: "initial",
      }),
    });

    const result = await apiKeysService.revoke(admin, "org-1", "abcdef1234", "redundant");
    expect(result.status).toBe("revoked");
    // Idempotent — no update write, no second emit.
    expect(hoisted.mockTxUpdate).not.toHaveBeenCalled();
  });

  it("refuses to revoke a key belonging to a different org (NotFoundError)", async () => {
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    hoisted.mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        id: "abcdef1234",
        organizationId: "other-org",
        status: "active",
      }),
    });

    await expect(
      apiKeysService.revoke(admin, "org-1", "abcdef1234", "trying"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── verify (hot auth path) ────────────────────────────────────────────────

describe("ApiKeysService.verify", () => {
  it("returns null for a malformed token", async () => {
    const result = await apiKeysService.verify("not-a-key", "127.0.0.1");
    expect(result).toBeNull();
    expect(hoisted.mockFindById).not.toHaveBeenCalled();
  });

  it("returns null when the hashPrefix doesn't exist", async () => {
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );
    const admin = buildAuthUser({ uid: "admin-1", organizationId: "org-1", roles: ["organizer"] });
    const { plaintext } = await apiKeysService.issue(admin, "org-1", {
      name: "t",
      scopes: ["event:read"],
      environment: "live",
    });

    hoisted.mockFindById.mockResolvedValue(null);

    const result = await apiKeysService.verify(plaintext, "127.0.0.1");
    expect(result).toBeNull();
  });

  it("returns null when the stored hash does not match (tampered body)", async () => {
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );
    const admin = buildAuthUser({ uid: "admin-1", organizationId: "org-1", roles: ["organizer"] });
    const issued = await apiKeysService.issue(admin, "org-1", {
      name: "t",
      scopes: ["event:read"],
      environment: "live",
    });

    // Swap one char in the body to simulate tampering.
    const tampered = issued.plaintext.replace(/./, (c) => (c === "A" ? "B" : "A"));

    hoisted.mockFindById.mockResolvedValue({
      ...issued.apiKey,
      keyHash: issued.apiKey.keyHash,
    });

    const result = await apiKeysService.verify(tampered, "127.0.0.1");
    expect(result).toBeNull();
  });

  it("admits a valid, active key and records usage best-effort", async () => {
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );
    const admin = buildAuthUser({ uid: "admin-1", organizationId: "org-1", roles: ["organizer"] });
    const issued = await apiKeysService.issue(admin, "org-1", {
      name: "t",
      scopes: ["event:read"],
      environment: "live",
    });

    hoisted.mockFindById.mockResolvedValue(issued.apiKey);

    const result = await apiKeysService.verify(issued.plaintext, "10.0.0.1");
    expect(result).not.toBeNull();
    expect(result!.apiKey.id).toBe(issued.apiKey.id);
    expect(result!.scopes).toEqual(["event:read"]);
    // recordUsage called with the client ip.
    expect(hoisted.mockRecordUsage).toHaveBeenCalledWith(issued.apiKey.id, "10.0.0.1");
  });

  it("refuses a revoked key even if the hash matches", async () => {
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );
    const admin = buildAuthUser({ uid: "admin-1", organizationId: "org-1", roles: ["organizer"] });
    const issued = await apiKeysService.issue(admin, "org-1", {
      name: "t",
      scopes: ["event:read"],
      environment: "live",
    });

    hoisted.mockFindById.mockResolvedValue({ ...issued.apiKey, status: "revoked" });

    const result = await apiKeysService.verify(issued.plaintext, "10.0.0.1");
    expect(result).toBeNull();
  });
});

// ─── scope expansion ───────────────────────────────────────────────────────

describe("ApiKeysService.expandScopes", () => {
  it("expands scope tokens into the concrete permission union", () => {
    const perms = apiKeysService.expandScopes(["event:read", "registration:read_all"]);
    expect(perms).toContain("event:read");
    expect(perms).toContain("registration:read_all");
    expect(perms).toContain("registration:read_own");
  });

  it("deduplicates overlapping scopes", () => {
    const perms = apiKeysService.expandScopes(["event:read", "event:read"]);
    expect(perms.filter((p) => p === "event:read")).toHaveLength(1);
  });

  it("produces an empty set for an empty scope list", () => {
    expect(apiKeysService.expandScopes([])).toEqual([]);
  });
});

// ─── Collision retry (senior-review #2) ──────────────────────────────────

describe("ApiKeysService.issue — prefix collision retry", () => {
  it("retries on ALREADY_EXISTS + returns the plaintext whose hash was actually stored", async () => {
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );

    // First create() call throws ALREADY_EXISTS, second succeeds.
    // The plaintext returned MUST match the keyHash we persisted on
    // the SECOND attempt, not the first one that collided.
    const collisionErr = Object.assign(new Error("ALREADY_EXISTS"), {
      code: 6, // gRPC ALREADY_EXISTS
    });
    let callCount = 0;
    hoisted.mockDocCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(collisionErr);
      return Promise.resolve(undefined);
    });

    const result = await apiKeysService.issue(admin, "org-1", {
      name: "test",
      scopes: ["event:read"],
      environment: "live",
    });

    // At least two create attempts.
    expect(hoisted.mockDocCreate).toHaveBeenCalledTimes(2);

    // The plaintext returned must hash (SHA-256) to the stored keyHash.
    const crypto = await import("node:crypto");
    const hash = crypto.createHash("sha256").update(result.plaintext).digest("hex");
    expect(hash).toBe(result.apiKey.keyHash);
  });

  it("gives up after MAX_PREFIX_COLLISION_RETRIES and throws INTERNAL_ERROR", async () => {
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );
    // Every attempt collides — should exhaust the retry budget.
    hoisted.mockDocCreate.mockRejectedValue(new Error("ALREADY_EXISTS"));

    await expect(
      apiKeysService.issue(admin, "org-1", {
        name: "test",
        scopes: ["event:read"],
        environment: "live",
      }),
    ).rejects.toThrow();
    // 3 attempts total (initial + 2 retries).
    expect(hoisted.mockDocCreate).toHaveBeenCalledTimes(3);
  });
});

// ─── verify() — throttled api_key.verified emit ──────────────────────────

describe("ApiKeysService.verify — api_key.verified throttled emit", () => {
  it("emits once on first verification from a given (ip, ua) pair", async () => {
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    const issued = await apiKeysService.issue(admin, "org-1", {
      name: "t",
      scopes: ["event:read"],
      environment: "live",
    });
    hoisted.mockFindById.mockResolvedValue(issued.apiKey);

    // Clear the emit list so we only count the verify emit.
    hoisted.mockBusEmit.mockClear();

    await apiKeysService.verify(issued.plaintext, "10.0.0.1", "Mozilla/5.0 Test");

    const verifiedEmits = hoisted.mockBusEmit.mock.calls.filter((c) => c[0] === "api_key.verified");
    expect(verifiedEmits).toHaveLength(1);
    expect(verifiedEmits[0][1]).toMatchObject({
      apiKeyId: issued.apiKey.id,
      organizationId: "org-1",
    });
    // ipHash + uaHash are 16-hex chars each, not plaintext.
    expect(verifiedEmits[0][1].ipHash).toMatch(/^[a-f0-9]{16}$/);
    expect(verifiedEmits[0][1].uaHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("does not re-emit within the throttle window for the same (key, ip, ua)", async () => {
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    const issued = await apiKeysService.issue(admin, "org-1", {
      name: "t",
      scopes: ["event:read"],
      environment: "live",
    });
    hoisted.mockFindById.mockResolvedValue(issued.apiKey);

    hoisted.mockBusEmit.mockClear();

    // Two back-to-back verifies from the same (ip, ua).
    await apiKeysService.verify(issued.plaintext, "10.0.0.1", "UA-A");
    await apiKeysService.verify(issued.plaintext, "10.0.0.1", "UA-A");

    const verifiedEmits = hoisted.mockBusEmit.mock.calls.filter((c) => c[0] === "api_key.verified");
    expect(verifiedEmits).toHaveLength(1);
  });

  it("emits again for a different IP — the 'new IP' signal SOC cares about", async () => {
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    const issued = await apiKeysService.issue(admin, "org-1", {
      name: "t",
      scopes: ["event:read"],
      environment: "live",
    });
    hoisted.mockFindById.mockResolvedValue(issued.apiKey);

    hoisted.mockBusEmit.mockClear();

    await apiKeysService.verify(issued.plaintext, "10.0.0.1", "UA-A");
    await apiKeysService.verify(issued.plaintext, "10.0.0.99", "UA-A");

    const verifiedEmits = hoisted.mockBusEmit.mock.calls.filter((c) => c[0] === "api_key.verified");
    expect(verifiedEmits).toHaveLength(2);
  });
});

// ─── Kill-switch ──────────────────────────────────────────────────────────

describe("ApiKeysService.verify — kill-switch", () => {
  it("short-circuits to null when API_KEY_AUTH_DISABLED is true", async () => {
    // Patch the mocked config module — vi.mock('@/config') was set up
    // earlier; here we reach into the mock registry to flip the flag.
    const configModule = await import("@/config");
    const originalFlag = configModule.config.API_KEY_AUTH_DISABLED;
    (configModule.config as unknown as { API_KEY_AUTH_DISABLED: boolean }).API_KEY_AUTH_DISABLED =
      true;
    try {
      const result = await apiKeysService.verify(
        "terk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_xxxx",
        "10.0.0.1",
        "UA",
      );
      expect(result).toBeNull();
      // Should not have hit Firestore at all.
      expect(hoisted.mockFindById).not.toHaveBeenCalled();
    } finally {
      (configModule.config as unknown as { API_KEY_AUTH_DISABLED: boolean }).API_KEY_AUTH_DISABLED =
        originalFlag;
    }
  });
});

// ─── rotate() — concurrent revoke ─────────────────────────────────────────

describe("ApiKeysService.rotate — concurrent revoke conflict", () => {
  it("throws CONFLICT when the key was revoked between the read and the transaction", async () => {
    const admin = buildAuthUser({
      uid: "admin-1",
      organizationId: "org-1",
      roles: ["organizer"],
    });
    hoisted.mockOrgFindByIdOrThrow.mockResolvedValue(
      buildOrgWithPlan("enterprise", { id: "org-1" }),
    );

    // Inside-transaction read sees the key as already revoked.
    hoisted.mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        id: "abcdef1234",
        organizationId: "org-1",
        status: "revoked",
        environment: "live",
        scopes: ["event:read"],
      }),
    });

    await expect(
      apiKeysService.rotate(admin, "org-1", "abcdef1234", { reason: "leaked" }),
    ).rejects.toThrow(/révoquée/i);
  });
});
