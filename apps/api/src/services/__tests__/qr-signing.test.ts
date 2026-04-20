import { describe, it, expect } from "vitest";
import {
  signQrPayload,
  signQrPayloadV1,
  signQrPayloadV2,
  verifyQrPayload,
  computeValidityWindow,
  checkScanTime,
  SCAN_CLOCK_SKEW_MS,
} from "../qr-signing";

// Helper — the v3 signer requires a validity window. Most tests don't care
// about the exact dates, only that sign/verify round-trips, so we bake a
// wide-open "this year" window here.
const NOW = Date.now();
const WIDE_NB = NOW - 24 * 60 * 60 * 1000;
const WIDE_NA = NOW + 365 * 24 * 60 * 60 * 1000;

describe("QR Code Signing", () => {
  describe("v3 format (with validity window)", () => {
    it("produces a 6-part QR value", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA);
      expect(qr.split(":")).toHaveLength(6);
    });

    it("round-trips sign → verify and restores the window", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA);
      const parsed = verifyQrPayload(qr);
      expect(parsed).not.toBeNull();
      expect(parsed!.registrationId).toBe("reg-1");
      expect(parsed!.eventId).toBe("ev-1");
      expect(parsed!.userId).toBe("u-1");
      expect(parsed!.version).toBe("v3");
      expect(parsed!.notBefore).toBeDefined();
      expect(parsed!.notAfter).toBeDefined();
      // base36 truncates to whole ms; allow 1 ms drift.
      expect(Math.abs(new Date(parsed!.notBefore!).getTime() - WIDE_NB)).toBeLessThanOrEqual(1);
      expect(Math.abs(new Date(parsed!.notAfter!).getTime() - WIDE_NA)).toBeLessThanOrEqual(1);
    });

    it("rejects tampered validity window (widened notAfter)", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA);
      const parts = qr.split(":");
      // bump notAfter by ~100 years — signature must break.
      parts[4] = Math.floor(WIDE_NA + 100 * 365 * 86400_000).toString(36);
      expect(verifyQrPayload(parts.join(":"))).toBeNull();
    });

    it("rejects tampered registrationId", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA);
      expect(verifyQrPayload(qr.replace("reg-1", "reg-2"))).toBeNull();
    });

    it("rejects tampered signature", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA);
      const parts = qr.split(":");
      parts[5] = "0".repeat(64);
      expect(verifyQrPayload(parts.join(":"))).toBeNull();
    });

    it("refuses to sign an inverted window (notAfter <= notBefore)", () => {
      expect(() => signQrPayload("reg-1", "ev-1", "u-1", NOW + 1000, NOW)).toThrow(
        /invalid validity window/,
      );
    });
  });

  describe("v2 format (legacy, backward compatible)", () => {
    it("produces a 5-part QR value", () => {
      const qr = signQrPayloadV2("reg-1", "ev-1", "u-1");
      expect(qr.split(":")).toHaveLength(5);
    });

    it("round-trips sign → verify with createdAt and no window", () => {
      const qr = signQrPayloadV2("reg-1", "ev-1", "u-1");
      const parsed = verifyQrPayload(qr);
      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBe("v2");
      expect(parsed!.createdAt).toBeDefined();
      expect(parsed!.notBefore).toBeUndefined();
      expect(parsed!.notAfter).toBeUndefined();
    });

    it("rejects tampered timestamp", () => {
      const qr = signQrPayloadV2("reg-1", "ev-1", "u-1");
      const parts = qr.split(":");
      parts[3] = "zzzzzzz";
      expect(verifyQrPayload(parts.join(":"))).toBeNull();
    });
  });

  describe("v1 format (legacy, backward compatible)", () => {
    it("produces a 4-part QR value", () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      expect(qr.split(":")).toHaveLength(4);
    });

    it("round-trips sign → verify with no timestamp and no window", () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      const parsed = verifyQrPayload(qr);
      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBe("v1");
      expect(parsed!.createdAt).toBeUndefined();
      expect(parsed!.notBefore).toBeUndefined();
      expect(parsed!.notAfter).toBeUndefined();
    });

    it("rejects tampered v1 QR", () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      expect(verifyQrPayload(qr.replace("reg-1", "reg-X"))).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("rejects empty string", () => {
      expect(verifyQrPayload("")).toBeNull();
    });

    it("rejects 3-part string", () => {
      expect(verifyQrPayload("a:b:c")).toBeNull();
    });

    it("rejects 7-part string", () => {
      expect(verifyQrPayload("a:b:c:d:e:f:g")).toBeNull();
    });

    it("rejects non-hex signature", () => {
      expect(verifyQrPayload("reg:ev:uid:not-valid-hex")).toBeNull();
    });

    it("rejects signature of wrong length", () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      const parts = qr.split(":");
      parts[3] = parts[3].slice(0, 10);
      expect(verifyQrPayload(parts.join(":"))).toBeNull();
    });
  });

  describe("validity window policy", () => {
    it("computeValidityWindow derives the canonical offsets from event dates", () => {
      const start = "2026-06-01T09:00:00.000Z";
      const end = "2026-06-01T18:00:00.000Z";
      const { notBefore, notAfter } = computeValidityWindow(start, end);
      expect(notBefore).toBe(new Date(start).getTime() - 24 * 60 * 60 * 1000);
      expect(notAfter).toBe(new Date(end).getTime() + 6 * 60 * 60 * 1000);
    });

    it("computeValidityWindow throws on invalid dates", () => {
      expect(() => computeValidityWindow("not-a-date", "also-bad")).toThrow();
    });

    it("checkScanTime classifies too_early / valid / expired", () => {
      const nb = 1_000_000;
      const na = 2_000_000;
      expect(checkScanTime(nb - SCAN_CLOCK_SKEW_MS - 1, nb, na)).toBe("too_early");
      expect(checkScanTime(nb, nb, na)).toBe("valid");
      expect(checkScanTime((nb + na) / 2, nb, na)).toBe("valid");
      expect(checkScanTime(na, nb, na)).toBe("valid");
      expect(checkScanTime(na + SCAN_CLOCK_SKEW_MS + 1, nb, na)).toBe("expired");
    });

    it("checkScanTime grants the configured clock-skew grace at both edges", () => {
      const nb = 1_000_000;
      const na = 2_000_000;
      // Just inside the grace — should be valid.
      expect(checkScanTime(nb - SCAN_CLOCK_SKEW_MS + 1, nb, na)).toBe("valid");
      expect(checkScanTime(na + SCAN_CLOCK_SKEW_MS - 1, nb, na)).toBe("valid");
    });
  });
});
