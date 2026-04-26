import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyMetaWebhookSignature } from "../whatsapp-webhook-signature.middleware";

// ─── Pure HMAC verification — pinned outside Fastify ──────────────────────
//
// The Fastify preHandler is a thin wrapper over `verifyMetaWebhookSignature`.
// We test the pure helper independently so the timing-safe compare,
// header-shape validation, and tampering-rejection paths are
// exercised without spinning up an HTTP layer.

const SECRET = "test-app-secret-1234567890abcdef";

function sign(body: string, secret: string = SECRET): string {
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${sig}`;
}

describe("verifyMetaWebhookSignature", () => {
  const body = JSON.stringify({ messageId: "wamid.X", status: "delivered" });

  it("accepts a valid signature", () => {
    expect(verifyMetaWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body (signature was for a different payload)", () => {
    const tamperedBody = body + "{}";
    expect(verifyMetaWebhookSignature(tamperedBody, sign(body), SECRET)).toBe(false);
  });

  it("rejects a tampered signature (last byte flipped)", () => {
    const ok = sign(body);
    const tampered = ok.slice(0, -1) + (ok.endsWith("0") ? "1" : "0");
    expect(verifyMetaWebhookSignature(body, tampered, SECRET)).toBe(false);
  });

  it("rejects a signature signed with a different secret", () => {
    expect(
      verifyMetaWebhookSignature(body, sign(body, "different-secret"), SECRET),
    ).toBe(false);
  });

  it("rejects when the signature header is missing", () => {
    expect(verifyMetaWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(body, undefined, SECRET)).toBe(false);
  });

  it("rejects when the signature header lacks the 'sha256=' prefix", () => {
    const sig = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifyMetaWebhookSignature(body, sig, SECRET)).toBe(false);
  });

  it("rejects when the hex portion is not 64 chars", () => {
    expect(verifyMetaWebhookSignature(body, "sha256=deadbeef", SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(body, `sha256=${"a".repeat(63)}`, SECRET)).toBe(false);
    expect(verifyMetaWebhookSignature(body, `sha256=${"a".repeat(65)}`, SECRET)).toBe(false);
  });

  it("rejects when the hex portion contains non-hex characters", () => {
    // 64 chars, but contains 'g' (not a hex digit).
    expect(
      verifyMetaWebhookSignature(body, `sha256=g${"a".repeat(63)}`, SECRET),
    ).toBe(false);
  });

  it("accepts an upper-case hex signature (Meta sends lower-case but be tolerant)", () => {
    const lower = sign(body);
    const upper = "sha256=" + lower.slice(7).toUpperCase();
    expect(verifyMetaWebhookSignature(body, upper, SECRET)).toBe(true);
  });

  it("rejects when the body is empty but the signature would match the empty string under a different secret", () => {
    // Belt-and-braces — empty body + sig signed with a different
    // secret must not pass even if both share the empty input.
    expect(
      verifyMetaWebhookSignature("", sign("", "wrong-secret"), SECRET),
    ).toBe(false);
  });
});
