import { describe, it, expect, vi } from "vitest";

vi.mock("@/config", () => ({
  config: {
    UNSUBSCRIBE_SECRET: "test-unsub-secret-must-be-at-least-32-chars-xyz",
  },
}));

import { signUnsubscribeToken, verifyUnsubscribeToken } from "../unsubscribe-token";

describe("unsubscribe-token", () => {
  it("round-trips: sign(userId, category) verifies back to the same pair", () => {
    const token = signUnsubscribeToken("user-abc-123", "transactional");
    const result = verifyUnsubscribeToken(token);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe("user-abc-123");
      expect(result.category).toBe("transactional");
    }
  });

  it("different categories for the same userId produce different tokens", () => {
    const t1 = signUnsubscribeToken("u-1", "transactional");
    const t2 = signUnsubscribeToken("u-1", "organizational");
    expect(t1).not.toBe(t2);
  });

  it("rejects a token with a tampered category (prevents cross-category unsubscribe)", () => {
    // Someone with a valid transactional token tries to swap to
    // organizational hoping they share the same signature.
    const token = signUnsubscribeToken("u-1", "transactional");
    const parts = token.split(".");
    const tampered = `${parts[0]}.organizational.${parts[2]}`;

    const result = verifyUnsubscribeToken(tampered);

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a token with a tampered userId", () => {
    const token = signUnsubscribeToken("u-1", "transactional");
    const parts = token.split(".");
    const victimEnc = Buffer.from("victim-uid", "utf8").toString("base64url");
    const tampered = `${victimEnc}.${parts[1]}.${parts[2]}`;

    const result = verifyUnsubscribeToken(tampered);

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects malformed tokens (empty / wrong part count)", () => {
    expect(verifyUnsubscribeToken("")).toEqual({ ok: false, reason: "malformed" });
    expect(verifyUnsubscribeToken("only-one")).toEqual({ ok: false, reason: "malformed" });
    expect(verifyUnsubscribeToken("two.parts")).toEqual({ ok: false, reason: "malformed" });
    expect(verifyUnsubscribeToken("a..c")).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects unknown categories without spending HMAC cycles", () => {
    // Mandatory categories can't be unsubscribed from and aren't in the
    // allowed set — the verifier rejects them on shape, not signature.
    const forged = "dXNlcg.auth.ZmFrZQ";
    expect(verifyUnsubscribeToken(forged)).toEqual({
      ok: false,
      reason: "unknown_category",
    });
    const bogusCategory = "dXNlcg.pigeon_mail.ZmFrZQ";
    expect(verifyUnsubscribeToken(bogusCategory)).toEqual({
      ok: false,
      reason: "unknown_category",
    });
  });

  it("throws when signing without a userId (programmer error)", () => {
    expect(() => signUnsubscribeToken("", "transactional")).toThrow(/userId/);
  });

  it("base64url-encodes the userId so special characters survive", () => {
    const token = signUnsubscribeToken("user+with/special.chars", "marketing");
    const result = verifyUnsubscribeToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe("user+with/special.chars");
    }
  });
});
