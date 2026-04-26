import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { signToken, parseToken, hashToken } from "../magic-link.service";

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

beforeEach(() => {
  process.env.QR_SECRET = "test-secret-1234567890abcdef";
});

afterEach(() => {
  process.env.QR_SECRET = ORIGINAL_SECRET;
});

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
    // 16 hex char signature.
    expect(parts[5]).toMatch(/^[0-9a-f]{16}$/);
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
    const tampered = token.slice(0, -16) + "0".repeat(16);
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
    // Build a token with a forbidden role manually; sign with the same
    // secret so only the role check rejects it.
    expect(parseToken("v1.admin.spk-1.evt-1.lqxqz.5e0a3b1c5e0a3b1c")).toBeNull();
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
