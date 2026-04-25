import { describe, it, expect, beforeEach, vi } from "vitest";
import { type FastifyRequest } from "fastify";

// Pin the config knobs to the documented ADR-0015 values so tests stay
// stable even if the defaults move (an env override in CI etc.).
vi.mock("@/config/index", () => ({
  config: {
    RATE_LIMIT_APIKEY_MAX: 600,
    RATE_LIMIT_USER_MAX: 120,
    RATE_LIMIT_IP_MAX: 30,
  },
}));

import {
  rateLimitKeyFor,
  rateLimitMaxFor,
  resolveRateLimitKey,
  hashRateLimitKey,
} from "../rate-limit.middleware";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeReq(headers: Record<string, string | undefined> = {}, ip = "203.0.113.42") {
  return { headers, ip } as unknown as FastifyRequest;
}

/**
 * Build a structurally valid Firebase ID token (signature is bogus —
 * `decodeJwtSubject` doesn't verify it). The middleware only reads the
 * `sub` claim from the payload segment.
 */
function fakeJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub, iat: 0, exp: 9_999_999_999 })).toString(
    "base64url",
  );
  // Bogus signature segment — we never verify it here.
  return `${header}.${payload}.signature-not-checked`;
}

// Note: parseApiKey verifies a 4-char checksum derived from the body via
// SHA-256(QR-style HMAC) — building a real one in-line would couple this
// test to that implementation. We instead mock the export so we control
// the parse outcome.
vi.mock("@/services/api-keys.service", () => ({
  parseApiKey: vi.fn((raw: string) => {
    if (raw === "terk_live_validbody40chars01234567890abcdefABCD_OK01") {
      return {
        env: "live" as const,
        body: "validbody40chars01234567890abcdefABCD",
        checksum: "OK01",
        hashPrefix: "validbody4",
      };
    }
    return null;
  }),
}));

// ─── resolveRateLimitKey ────────────────────────────────────────────────

describe("resolveRateLimitKey", () => {
  it("returns ip:* for unauthenticated requests", () => {
    const req = makeReq({}, "198.51.100.7");
    const desc = resolveRateLimitKey(req);
    expect(desc).toEqual({ space: "ip", identifier: "198.51.100.7" });
  });

  it("returns ip:* when Authorization header is malformed", () => {
    const req = makeReq({ authorization: "not-a-bearer" }, "198.51.100.7");
    expect(resolveRateLimitKey(req)).toEqual({ space: "ip", identifier: "198.51.100.7" });
  });

  it("returns user:<sub> for a Firebase ID token (decodes payload, no verify)", () => {
    const req = makeReq({ authorization: `Bearer ${fakeJwt("alice-uid-001")}` });
    expect(resolveRateLimitKey(req)).toEqual({ space: "user", identifier: "alice-uid-001" });
  });

  it("falls through to ip:* when JWT shape is broken", () => {
    const req = makeReq({ authorization: "Bearer not.a.jwt" }, "198.51.100.7");
    // `not.a.jwt` has 3 segments but the middle one isn't valid base64
    // JSON — decoder returns null, we fall back to ip.
    expect(resolveRateLimitKey(req)).toEqual({ space: "ip", identifier: "198.51.100.7" });
  });

  it("falls through to ip:* when JWT payload has no `sub` claim", () => {
    // JWT with only `iat` / `exp` — no sub.
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iat: 0 })).toString("base64url");
    const noSubToken = `${header}.${payload}.sig`;
    const req = makeReq({ authorization: `Bearer ${noSubToken}` }, "198.51.100.7");
    expect(resolveRateLimitKey(req)).toEqual({ space: "ip", identifier: "198.51.100.7" });
  });

  it("returns apikey:<hashPrefix> for a valid `terk_*` API key", () => {
    const req = makeReq({
      authorization: "Bearer terk_live_validbody40chars01234567890abcdefABCD_OK01",
    });
    expect(resolveRateLimitKey(req)).toEqual({ space: "apikey", identifier: "validbody4" });
  });

  it("falls through to ip:* when `terk_*` checksum fails (parseApiKey returns null)", () => {
    // Anything not matching the mocked happy-path string returns null.
    const req = makeReq({ authorization: "Bearer terk_live_typo_typo" }, "198.51.100.7");
    expect(resolveRateLimitKey(req)).toEqual({ space: "ip", identifier: "198.51.100.7" });
  });
});

// ─── rateLimitKeyFor (string form) ──────────────────────────────────────

describe("rateLimitKeyFor", () => {
  it("emits `ip:<addr>` for unauthenticated", () => {
    expect(rateLimitKeyFor(makeReq({}, "198.51.100.7"))).toBe("ip:198.51.100.7");
  });

  it("emits `user:<uid>` for a Firebase ID token", () => {
    expect(rateLimitKeyFor(makeReq({ authorization: `Bearer ${fakeJwt("bob-002")}` }))).toBe(
      "user:bob-002",
    );
  });

  it("emits `apikey:<prefix>` for a valid `terk_*` token", () => {
    expect(
      rateLimitKeyFor(
        makeReq({ authorization: "Bearer terk_live_validbody40chars01234567890abcdefABCD_OK01" }),
      ),
    ).toBe("apikey:validbody4");
  });

  it("never returns a colliding key across spaces (namespace prefix isolates buckets)", () => {
    // A user uid that happens to look like an IP must not collide with
    // an actual ip:* bucket. The `space:` prefix guarantees this.
    const userKey = rateLimitKeyFor(makeReq({ authorization: `Bearer ${fakeJwt("198.51.100.7")}` }));
    const ipKey = rateLimitKeyFor(makeReq({}, "198.51.100.7"));
    expect(userKey).toBe("user:198.51.100.7");
    expect(ipKey).toBe("ip:198.51.100.7");
    expect(userKey).not.toEqual(ipKey);
  });
});

// ─── rateLimitMaxFor ────────────────────────────────────────────────────

describe("rateLimitMaxFor", () => {
  it("returns RATE_LIMIT_APIKEY_MAX (600) for `apikey:*` requests", () => {
    const req = makeReq({
      authorization: "Bearer terk_live_validbody40chars01234567890abcdefABCD_OK01",
    });
    expect(rateLimitMaxFor(req)).toBe(600);
  });

  it("returns RATE_LIMIT_USER_MAX (120) for `user:*` requests", () => {
    const req = makeReq({ authorization: `Bearer ${fakeJwt("alice")}` });
    expect(rateLimitMaxFor(req)).toBe(120);
  });

  it("returns RATE_LIMIT_IP_MAX (30) for `ip:*` requests", () => {
    expect(rateLimitMaxFor(makeReq({}, "198.51.100.7"))).toBe(30);
  });

  it("returns IP budget when the JWT is malformed (defensive: never grants user-tier headroom on a broken token)", () => {
    const req = makeReq({ authorization: "Bearer broken" }, "198.51.100.7");
    expect(rateLimitMaxFor(req)).toBe(30);
  });
});

// ─── hashRateLimitKey (Redis-readiness helper) ──────────────────────────

describe("hashRateLimitKey", () => {
  it("returns a stable 32-char hex digest", () => {
    const h = hashRateLimitKey("user:alice");
    expect(h).toHaveLength(32);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(hashRateLimitKey("user:alice")).toBe(h); // deterministic
  });

  it("is collision-resistant across key spaces", () => {
    expect(hashRateLimitKey("user:198.51.100.7")).not.toEqual(
      hashRateLimitKey("ip:198.51.100.7"),
    );
  });
});

// ─── Sentinel: prefix isolation invariant ─────────────────────────────────

describe("ADR-0015 invariant — bucket key prefix MUST isolate spaces", () => {
  it("every emitted key starts with one of the 3 known prefixes", () => {
    const cases = [
      makeReq({}, "198.51.100.7"),
      makeReq({ authorization: `Bearer ${fakeJwt("alice")}` }),
      makeReq({ authorization: "Bearer terk_live_validbody40chars01234567890abcdefABCD_OK01" }),
    ];
    for (const req of cases) {
      const key = rateLimitKeyFor(req);
      expect(key).toMatch(/^(apikey|user|ip):/);
    }
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
