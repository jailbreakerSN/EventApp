import { describe, it, expect } from "vitest";
import {
  signQrPayload,
  signQrPayloadV1,
  verifyQrPayload,
} from "../qr-signing";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("QR Code Signing", () => {
  describe("v2 format (with timestamp)", () => {
    it("produces a 5-part QR value", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1");
      expect(qr.split(":")).toHaveLength(5);
    });

    it("round-trips sign → verify", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1");
      const parsed = verifyQrPayload(qr);
      expect(parsed).not.toBeNull();
      expect(parsed!.registrationId).toBe("reg-1");
      expect(parsed!.eventId).toBe("ev-1");
      expect(parsed!.userId).toBe("u-1");
      expect(parsed!.createdAt).toBeDefined();
    });

    it("rejects tampered registrationId", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1");
      const tampered = qr.replace("reg-1", "reg-2");
      expect(verifyQrPayload(tampered)).toBeNull();
    });

    it("rejects tampered timestamp", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1");
      const parts = qr.split(":");
      parts[3] = "zzzzzzz"; // tamper timestamp
      expect(verifyQrPayload(parts.join(":"))).toBeNull();
    });

    it("rejects tampered signature", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1");
      const parts = qr.split(":");
      parts[4] = "0".repeat(64); // zero signature
      expect(verifyQrPayload(parts.join(":"))).toBeNull();
    });
  });

  describe("v1 format (legacy, backward compatible)", () => {
    it("produces a 4-part QR value", () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      expect(qr.split(":")).toHaveLength(4);
    });

    it("round-trips sign → verify", () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      const parsed = verifyQrPayload(qr);
      expect(parsed).not.toBeNull();
      expect(parsed!.registrationId).toBe("reg-1");
      expect(parsed!.eventId).toBe("ev-1");
      expect(parsed!.userId).toBe("u-1");
      expect(parsed!.createdAt).toBeUndefined();
    });

    it("rejects tampered v1 QR", () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      const tampered = qr.replace("reg-1", "reg-X");
      expect(verifyQrPayload(tampered)).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("rejects empty string", () => {
      expect(verifyQrPayload("")).toBeNull();
    });

    it("rejects 3-part string", () => {
      expect(verifyQrPayload("a:b:c")).toBeNull();
    });

    it("rejects 6-part string", () => {
      expect(verifyQrPayload("a:b:c:d:e:f")).toBeNull();
    });

    it("rejects non-hex signature", () => {
      expect(verifyQrPayload("reg:ev:uid:not-valid-hex")).toBeNull();
    });

    it("rejects signature of wrong length", () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      const parts = qr.split(":");
      parts[3] = parts[3].slice(0, 10); // truncate
      expect(verifyQrPayload(parts.join(":"))).toBeNull();
    });
  });
});
