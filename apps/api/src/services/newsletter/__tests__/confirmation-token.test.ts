import { describe, it, expect, vi } from "vitest";

vi.mock("@/config", () => ({
  config: {
    NEWSLETTER_CONFIRM_SECRET: "test-secret-must-be-at-least-32-characters-long-xyz",
  },
}));

import { signConfirmationToken, verifyConfirmationToken } from "../confirmation-token";

describe("confirmation-token", () => {
  it("round-trips: a token signed for a subscriber verifies back to that id", () => {
    const token = signConfirmationToken("sub-42", { now: 1_700_000_000_000 });
    const result = verifyConfirmationToken(token, 1_700_000_000_000);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subscriberId).toBe("sub-42");
      // Default 7-day TTL → expiresAt = now + 7*24*60*60*1000
      expect(result.expiresAt).toBe(1_700_000_000_000 + 7 * 24 * 60 * 60 * 1000);
    }
  });

  it("produces three dot-separated parts (id, expiry, signature)", () => {
    const token = signConfirmationToken("sub-1");
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("sub-1");
    expect(Number(parts[1])).toBeGreaterThan(Date.now());
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });

  it("rejects malformed tokens (empty, wrong shape)", () => {
    expect(verifyConfirmationToken("")).toEqual({ ok: false, reason: "malformed" });
    expect(verifyConfirmationToken("only-one-part")).toEqual({ ok: false, reason: "malformed" });
    expect(verifyConfirmationToken("two.parts")).toEqual({ ok: false, reason: "malformed" });
    expect(verifyConfirmationToken("sub.abc.def")).toEqual({ ok: false, reason: "malformed" });
    expect(verifyConfirmationToken("sub..sig")).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a tampered subscriber id with bad_signature", () => {
    const token = signConfirmationToken("sub-1", { now: 1_700_000_000_000 });
    const parts = token.split(".");
    const tampered = `sub-EVIL.${parts[1]}.${parts[2]}`;

    const result = verifyConfirmationToken(tampered, 1_700_000_000_000);

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered expiry with bad_signature (prevents TTL extension)", () => {
    const token = signConfirmationToken("sub-1", { now: 1_700_000_000_000 });
    const parts = token.split(".");
    // Extend expiry by 1000 years
    const tampered = `${parts[0]}.${Number(parts[1]) + 31_536_000_000_000}.${parts[2]}`;

    const result = verifyConfirmationToken(tampered, 1_700_000_000_000);

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects expired tokens with expired", () => {
    const token = signConfirmationToken("sub-1", {
      now: 1_700_000_000_000,
      ttlMs: 1000, // 1 second
    });

    const result = verifyConfirmationToken(token, 1_700_000_000_000 + 2000);

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("returns bad_signature (not expired) for a forged expired token", () => {
    // Build a token with a bogus signature but plausible expiry in the past.
    // The verifier should report "bad_signature" — it must not leak that
    // the token would have expired either way.
    const now = 1_700_000_000_000;
    const past = now - 10_000;
    const forged = `sub-1.${past}.ZmFrZXNpZw`;

    const result = verifyConfirmationToken(forged, now);

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects non-integer / negative expiry fields as malformed", () => {
    expect(verifyConfirmationToken("sub-1.notanumber.sig")).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyConfirmationToken("sub-1.-5.sig")).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyConfirmationToken("sub-1.3.14.sig")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
