import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { buildAuthUser } from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────
// Minimal in-memory user-doc store keyed by uid. The service reads the
// doc via `tx.get(userRef)` and writes back via `tx.update(userRef, …)`.
// We let the same ref object carry both ops so the runTransaction shim
// can route them without a per-call dispatch table.

type UserDoc = { fcmTokens?: unknown; updatedAt?: string } | undefined;

const userStore = new Map<string, UserDoc>();

function makeUserRef(uid: string) {
  return {
    __uid: uid,
    get: async () => ({
      exists: userStore.has(uid),
      data: () => userStore.get(uid),
    }),
    update: async (patch: Record<string, unknown>) => {
      const existing = userStore.get(uid) ?? {};
      userStore.set(uid, { ...existing, ...patch } as UserDoc);
    },
  };
}

vi.mock("@/config/firebase", () => ({
  db: {
    collection: (_name: string) => ({
      doc: (id: string) => makeUserRef(id),
    }),
    runTransaction: async (cb: (tx: unknown) => unknown) => {
      const tx = {
        get: (ref: { get: () => unknown }) => ref.get(),
        update: (ref: { update: (data: unknown) => unknown }, data: unknown) =>
          ref.update(data),
      };
      return cb(tx);
    },
  },
  COLLECTIONS: { USERS: "users" },
}));

const emitMock = vi.fn();
vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: (...args: unknown[]) => emitMock(...args) },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Import after mocks so module resolution picks up the stubs.
import { fcmTokensService, fingerprintToken } from "../fcm-tokens.service";

function fp(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

beforeEach(() => {
  userStore.clear();
  emitMock.mockClear();
});

describe("FcmTokensService.register", () => {
  it("appends a new token and emits fcm.token_registered", async () => {
    const user = buildAuthUser();
    userStore.set(user.uid, { fcmTokens: [] });

    const result = await fcmTokensService.register(user, {
      token: "fcm-web-abc",
      platform: "web",
      userAgent: "Mozilla/5.0",
    });

    expect(result.status).toBe("registered");
    expect(result.tokenFingerprint).toBe(fp("fcm-web-abc"));
    expect(result.tokenCount).toBe(1);

    const stored = userStore.get(user.uid)!;
    const tokens = stored.fcmTokens as Array<{ token: string; platform: string }>;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ token: "fcm-web-abc", platform: "web" });

    expect(emitMock).toHaveBeenCalledWith(
      "fcm.token_registered",
      expect.objectContaining({
        userId: user.uid,
        platform: "web",
        tokenFingerprint: fp("fcm-web-abc"),
        tokenCount: 1,
        status: "registered",
      }),
    );
    // The raw token MUST never leak to the audit event.
    const payload = emitMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain("fcm-web-abc");
  });

  it("refreshes lastSeenAt on duplicate register without appending", async () => {
    const user = buildAuthUser();
    const earlier = "2026-04-01T00:00:00.000Z";
    userStore.set(user.uid, {
      fcmTokens: [
        {
          token: "fcm-web-abc",
          platform: "web",
          registeredAt: earlier,
          lastSeenAt: earlier,
        },
      ],
    });

    const result = await fcmTokensService.register(user, {
      token: "fcm-web-abc",
      platform: "web",
    });

    expect(result.status).toBe("refreshed");
    expect(result.tokenCount).toBe(1);

    const tokens = userStore.get(user.uid)!.fcmTokens as Array<{
      token: string;
      registeredAt: string;
      lastSeenAt: string;
    }>;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.registeredAt).toBe(earlier); // preserved
    expect(tokens[0]!.lastSeenAt).not.toBe(earlier); // bumped
  });

  it("caps at 10 tokens by evicting the oldest by lastSeenAt", async () => {
    const user = buildAuthUser();
    // Seed 10 tokens with ascending lastSeenAt — t0 oldest.
    const seeded = Array.from({ length: 10 }, (_, i) => ({
      token: `tok-${i}`,
      platform: "web" as const,
      registeredAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      lastSeenAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    userStore.set(user.uid, { fcmTokens: seeded });

    const result = await fcmTokensService.register(user, {
      token: "tok-new",
      platform: "web",
    });

    expect(result.status).toBe("registered");
    expect(result.tokenCount).toBe(10);

    const tokens = userStore.get(user.uid)!.fcmTokens as Array<{ token: string }>;
    expect(tokens).toHaveLength(10);
    // Oldest (tok-0) evicted; the new token retained.
    expect(tokens.map((t) => t.token)).not.toContain("tok-0");
    expect(tokens.map((t) => t.token)).toContain("tok-new");
  });

  it("transparently upgrades a legacy string[] fcmTokens field on first write", async () => {
    const user = buildAuthUser();
    userStore.set(user.uid, {
      // Legacy shape — plain strings.
      fcmTokens: ["legacy-token-1", "legacy-token-2"] as unknown as string[],
    });

    const result = await fcmTokensService.register(user, {
      token: "fresh-token",
      platform: "web",
    });

    expect(result.status).toBe("registered");
    expect(result.tokenCount).toBe(3);

    const tokens = userStore.get(user.uid)!.fcmTokens as Array<{
      token: string;
      platform: string;
    }>;
    // Every entry now carries the new shape with platform + timestamps.
    for (const t of tokens) {
      expect(typeof t).toBe("object");
      expect(t).toHaveProperty("token");
      expect(t).toHaveProperty("platform");
    }
    expect(tokens.map((t) => t.token).sort()).toEqual(
      ["fresh-token", "legacy-token-1", "legacy-token-2"].sort(),
    );
  });
});

describe("FcmTokensService.revoke", () => {
  it("removes the matching token and emits fcm.token_revoked with removed=true", async () => {
    const user = buildAuthUser();
    userStore.set(user.uid, {
      fcmTokens: [
        {
          token: "keep-me",
          platform: "web",
          registeredAt: "2026-04-01T00:00:00.000Z",
          lastSeenAt: "2026-04-01T00:00:00.000Z",
        },
        {
          token: "drop-me",
          platform: "web",
          registeredAt: "2026-04-01T00:00:00.000Z",
          lastSeenAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    });

    const result = await fcmTokensService.revoke(user, fp("drop-me"));
    expect(result.removed).toBe(true);
    expect(result.tokenCount).toBe(1);

    const tokens = userStore.get(user.uid)!.fcmTokens as Array<{ token: string }>;
    expect(tokens.map((t) => t.token)).toEqual(["keep-me"]);

    expect(emitMock).toHaveBeenCalledWith(
      "fcm.token_revoked",
      expect.objectContaining({
        userId: user.uid,
        removed: true,
        tokenCount: 1,
        tokenFingerprint: fp("drop-me"),
      }),
    );
  });

  it("is a no-op when the fingerprint does not match (stale session)", async () => {
    const user = buildAuthUser();
    userStore.set(user.uid, {
      fcmTokens: [
        {
          token: "keep-me",
          platform: "web",
          registeredAt: "2026-04-01T00:00:00.000Z",
          lastSeenAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    });

    const result = await fcmTokensService.revoke(user, fp("never-existed"));
    expect(result.removed).toBe(false);
    expect(result.tokenCount).toBe(1);

    const tokens = userStore.get(user.uid)!.fcmTokens as Array<{ token: string }>;
    expect(tokens.map((t) => t.token)).toEqual(["keep-me"]);

    // We still emit the revoke event — the audit trail wants the attempt
    // recorded even when the fingerprint didn't match.
    expect(emitMock).toHaveBeenCalledWith(
      "fcm.token_revoked",
      expect.objectContaining({ removed: false, tokenCount: 1 }),
    );
  });
});

describe("FcmTokensService.revokeAllForUser", () => {
  it("clears every token and emits fcm.tokens_cleared", async () => {
    const user = buildAuthUser();
    userStore.set(user.uid, {
      fcmTokens: [
        {
          token: "a",
          platform: "web",
          registeredAt: "2026-04-01T00:00:00.000Z",
          lastSeenAt: "2026-04-01T00:00:00.000Z",
        },
        {
          token: "b",
          platform: "web",
          registeredAt: "2026-04-01T00:00:00.000Z",
          lastSeenAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    });

    const result = await fcmTokensService.revokeAllForUser(user);
    expect(result.removedCount).toBe(2);

    const stored = userStore.get(user.uid)!;
    expect(stored.fcmTokens).toEqual([]);

    expect(emitMock).toHaveBeenCalledWith(
      "fcm.tokens_cleared",
      expect.objectContaining({ userId: user.uid, removedCount: 2 }),
    );
  });

  it("handles a user with no tokens (emits removedCount=0)", async () => {
    const user = buildAuthUser();
    userStore.set(user.uid, { fcmTokens: [] });

    const result = await fcmTokensService.revokeAllForUser(user);
    expect(result.removedCount).toBe(0);
    expect(emitMock).toHaveBeenCalledWith(
      "fcm.tokens_cleared",
      expect.objectContaining({ removedCount: 0 }),
    );
  });
});

describe("fingerprintToken", () => {
  it("returns a 16-char lowercase hex string", () => {
    const out = fingerprintToken("some-token-value");
    expect(out).toMatch(/^[a-f0-9]{16}$/);
  });
});
