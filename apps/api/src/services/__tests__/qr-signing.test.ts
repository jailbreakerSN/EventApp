import { describe, it, expect } from "vitest";
import {
  signQrPayload,
  signQrPayloadV1,
  signQrPayloadV2,
  signQrPayloadV4,
  verifyQrPayload,
  computeValidityWindow,
  checkScanTime,
  deriveEventKey,
  generateEventKid,
  SCAN_CLOCK_SKEW_MS,
} from "../qr-signing";

// Wide-open window so most tests don't drift under the real-clock scan-time
// check. Window-specific tests override.
const NOW = Date.now();
const WIDE_NB = NOW - 24 * 60 * 60 * 1000;
const WIDE_NA = NOW + 365 * 24 * 60 * 60 * 1000;

// Default resolver for v4 tests — returns the key derived via the same
// HKDF as the signer. Test subclasses override to exercise the
// rotation-history, unknown-kid, and cross-event-replay paths.
const syncResolver = (registry: Record<string, string>) => (eventId: string, kid: string) =>
  registry[eventId] === kid ? deriveEventKey(eventId, kid) : null;

describe("QR Code Signing", () => {
  describe("v4 format (per-event HKDF keys + kid rotation)", () => {
    it("produces a 7-part QR value", () => {
      const kid = generateEventKid();
      const qr = signQrPayloadV4("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA, kid);
      expect(qr.split(":")).toHaveLength(7);
    });

    it("round-trips sign → verify and exposes the kid + window on the parsed payload", async () => {
      const kid = generateEventKid();
      const qr = signQrPayloadV4("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA, kid);
      const parsed = await verifyQrPayload(qr, syncResolver({ "ev-1": kid }));
      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBe("v4");
      expect(parsed!.kid).toBe(kid);
      expect(parsed!.registrationId).toBe("reg-1");
      expect(parsed!.eventId).toBe("ev-1");
      expect(parsed!.userId).toBe("u-1");
      expect(parsed!.notBefore).toBeDefined();
      expect(parsed!.notAfter).toBeDefined();
    });

    it("rejects a v4 payload when no key resolver is supplied (fail closed)", async () => {
      const kid = generateEventKid();
      const qr = signQrPayloadV4("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA, kid);
      // Calling verify without the resolver must not silently accept.
      expect(await verifyQrPayload(qr)).toBeNull();
    });

    it("rejects a v4 payload when the resolver returns null (unknown kid)", async () => {
      const qr = signQrPayloadV4("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA, generateEventKid());
      const resolver = () => null; // unknown
      expect(await verifyQrPayload(qr, resolver)).toBeNull();
    });

    it("rejects a v4 payload signed for event A when presented as event B (per-event isolation)", async () => {
      const kid = generateEventKid();
      const qrA = signQrPayloadV4("reg-1", "ev-A", "u-1", WIDE_NB, WIDE_NA, kid);
      // Attacker swaps the eventId in the string — HMAC breaks because the
      // payload that was signed included `ev-A` but verifier re-signs with
      // `ev-B`.
      const forged = qrA.replace(":ev-A:", ":ev-B:");
      expect(await verifyQrPayload(forged, syncResolver({ "ev-B": kid }))).toBeNull();
    });

    it("accepts a retired-but-historically-known kid (rotation overlap window)", async () => {
      const retiredKid = generateEventKid();
      const currentKid = generateEventKid();
      const qr = signQrPayloadV4("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA, retiredKid);
      // Event now uses `currentKid`, but the retired one is still in history.
      const resolver = (eventId: string, kid: string) =>
        eventId === "ev-1" && (kid === currentKid || kid === retiredKid)
          ? deriveEventKey(eventId, kid)
          : null;
      const parsed = await verifyQrPayload(qr, resolver);
      expect(parsed).not.toBeNull();
      expect(parsed!.kid).toBe(retiredKid);
    });

    it("stops accepting a kid once it's evicted from the rotation history", async () => {
      const evictedKid = generateEventKid();
      const qr = signQrPayloadV4("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA, evictedKid);
      // History cleared — event only knows the new kid now.
      const resolver = (eventId: string, kid: string) =>
        eventId === "ev-1" && kid === "otherkid" ? deriveEventKey(eventId, kid) : null;
      expect(await verifyQrPayload(qr, resolver)).toBeNull();
    });

    it("refuses to sign with an invalid kid", () => {
      expect(() => signQrPayloadV4("r", "e", "u", WIDE_NB, WIDE_NA, "!!bad!!")).toThrow(
        /invalid kid/,
      );
    });

    it("refuses to sign an inverted window", () => {
      expect(() => signQrPayloadV4("r", "e", "u", NOW + 1000, NOW, generateEventKid())).toThrow(
        /invalid validity window/,
      );
    });

    it("generateEventKid produces an 8-char base36 string", () => {
      const kid = generateEventKid();
      expect(kid).toMatch(/^[0-9a-z]{8}$/);
      // Regeneration is not the same — entropy lives up to ~40 bits.
      expect(generateEventKid()).not.toBe(kid);
    });
  });

  describe("v3 format (with validity window)", () => {
    it("produces a 6-part QR value", () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA);
      expect(qr.split(":")).toHaveLength(6);
    });

    it("round-trips sign → verify and restores the window", async () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA);
      const parsed = await verifyQrPayload(qr);
      expect(parsed).not.toBeNull();
      expect(parsed!.registrationId).toBe("reg-1");
      expect(parsed!.eventId).toBe("ev-1");
      expect(parsed!.userId).toBe("u-1");
      expect(parsed!.version).toBe("v3");
      expect(parsed!.notBefore).toBeDefined();
      expect(parsed!.notAfter).toBeDefined();
      expect(Math.abs(new Date(parsed!.notBefore!).getTime() - WIDE_NB)).toBeLessThanOrEqual(1);
      expect(Math.abs(new Date(parsed!.notAfter!).getTime() - WIDE_NA)).toBeLessThanOrEqual(1);
    });

    it("rejects tampered validity window (widened notAfter)", async () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA);
      const parts = qr.split(":");
      parts[4] = Math.floor(WIDE_NA + 100 * 365 * 86400_000).toString(36);
      expect(await verifyQrPayload(parts.join(":"))).toBeNull();
    });

    it("rejects tampered registrationId", async () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA);
      expect(await verifyQrPayload(qr.replace("reg-1", "reg-2"))).toBeNull();
    });

    it("rejects tampered signature", async () => {
      const qr = signQrPayload("reg-1", "ev-1", "u-1", WIDE_NB, WIDE_NA);
      const parts = qr.split(":");
      parts[5] = "0".repeat(64);
      expect(await verifyQrPayload(parts.join(":"))).toBeNull();
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

    it("round-trips sign → verify with createdAt and no window", async () => {
      const qr = signQrPayloadV2("reg-1", "ev-1", "u-1");
      const parsed = await verifyQrPayload(qr);
      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBe("v2");
      expect(parsed!.createdAt).toBeDefined();
      expect(parsed!.notBefore).toBeUndefined();
      expect(parsed!.notAfter).toBeUndefined();
    });

    it("rejects tampered timestamp", async () => {
      const qr = signQrPayloadV2("reg-1", "ev-1", "u-1");
      const parts = qr.split(":");
      parts[3] = "zzzzzzz";
      expect(await verifyQrPayload(parts.join(":"))).toBeNull();
    });
  });

  describe("v1 format (legacy, backward compatible)", () => {
    it("produces a 4-part QR value", () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      expect(qr.split(":")).toHaveLength(4);
    });

    it("round-trips sign → verify with no timestamp and no window", async () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      const parsed = await verifyQrPayload(qr);
      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBe("v1");
      expect(parsed!.createdAt).toBeUndefined();
      expect(parsed!.notBefore).toBeUndefined();
      expect(parsed!.notAfter).toBeUndefined();
    });

    it("rejects tampered v1 QR", async () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      expect(await verifyQrPayload(qr.replace("reg-1", "reg-X"))).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("rejects empty string", async () => {
      expect(await verifyQrPayload("")).toBeNull();
    });

    it("rejects 3-part string", async () => {
      expect(await verifyQrPayload("a:b:c")).toBeNull();
    });

    it("rejects 8-part string (no branch yet)", async () => {
      expect(await verifyQrPayload("a:b:c:d:e:f:g:h")).toBeNull();
    });

    it("rejects non-hex signature", async () => {
      expect(await verifyQrPayload("reg:ev:uid:not-valid-hex")).toBeNull();
    });

    it("rejects signature of wrong length", async () => {
      const qr = signQrPayloadV1("reg-1", "ev-1", "u-1");
      const parts = qr.split(":");
      parts[3] = parts[3].slice(0, 10);
      expect(await verifyQrPayload(parts.join(":"))).toBeNull();
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
      expect(checkScanTime(nb - SCAN_CLOCK_SKEW_MS + 1, nb, na)).toBe("valid");
      expect(checkScanTime(na + SCAN_CLOCK_SKEW_MS - 1, nb, na)).toBe("valid");
    });
  });

  describe("v4 key derivation", () => {
    it("produces different keys for different events with the same kid", () => {
      const kid = generateEventKid();
      expect(deriveEventKey("ev-A", kid).equals(deriveEventKey("ev-B", kid))).toBe(false);
    });

    it("produces different keys for the same event across different kids", () => {
      const k1 = generateEventKid();
      const k2 = generateEventKid();
      expect(deriveEventKey("ev-A", k1).equals(deriveEventKey("ev-A", k2))).toBe(false);
    });

    it("is deterministic across calls (same inputs → same key)", () => {
      const kid = generateEventKid();
      expect(deriveEventKey("ev-A", kid).equals(deriveEventKey("ev-A", kid))).toBe(true);
    });
  });
});
