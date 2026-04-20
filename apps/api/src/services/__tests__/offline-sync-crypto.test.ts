import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  sealOfflineSyncPayload,
  __openOfflineSyncPayloadForTest,
  __generateClientKeyPairForTest,
} from "../offline-sync-crypto";

// Shared-fixture payload reused across round-trip cases. Small enough to
// keep the GCM authenticity tests fast, wide enough to include nested
// structures + unicode so any encoding regression shows up in the diff.
const SAMPLE_PAYLOAD = {
  eventId: "ev-1",
  organizationId: "org-1",
  registrations: [
    {
      id: "reg-1",
      qrCodeValue: "reg-1:ev-1:user-1:0:z:abcdef",
      participantName: "Aïssatou Ndiaye",
      ticketTypeName: "VIP",
    },
  ],
  syncedAt: "2026-04-20T10:00:00.000Z",
};

describe("offline-sync-crypto", () => {
  it("round-trips a payload through ECDH → HKDF → AES-GCM", () => {
    const { privateKey, publicKeyRaw } = __generateClientKeyPairForTest();

    const envelope = sealOfflineSyncPayload(SAMPLE_PAYLOAD, publicKeyRaw, "ev-1");

    expect(envelope.protocol).toBe("ecdh-x25519-aes256gcm-v1");
    expect(envelope.serverPublicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.tag).toMatch(/^[A-Za-z0-9_-]+$/);

    const decrypted = __openOfflineSyncPayloadForTest(envelope, privateKey, "ev-1");
    expect(decrypted).toEqual(SAMPLE_PAYLOAD);
  });

  it("produces a fresh server ephemeral keypair on every seal (forward secrecy)", () => {
    const { publicKeyRaw } = __generateClientKeyPairForTest();
    const a = sealOfflineSyncPayload(SAMPLE_PAYLOAD, publicKeyRaw, "ev-1");
    const b = sealOfflineSyncPayload(SAMPLE_PAYLOAD, publicKeyRaw, "ev-1");
    expect(a.serverPublicKey).not.toBe(b.serverPublicKey);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("tag-fails when AAD is swapped (prevents cross-event replay)", () => {
    const { privateKey, publicKeyRaw } = __generateClientKeyPairForTest();
    const envelope = sealOfflineSyncPayload(SAMPLE_PAYLOAD, publicKeyRaw, "ev-A");

    // Same envelope, but client tries to decrypt as if it were event B.
    expect(() => __openOfflineSyncPayloadForTest(envelope, privateKey, "ev-B")).toThrow();
  });

  it("tag-fails on any ciphertext tampering", () => {
    const { privateKey, publicKeyRaw } = __generateClientKeyPairForTest();
    const envelope = sealOfflineSyncPayload(SAMPLE_PAYLOAD, publicKeyRaw, "ev-1");

    // Flip one bit of the ciphertext (first b64url char: swap 'A' ↔ 'B' or equivalent).
    const tampered = {
      ...envelope,
      ciphertext: envelope.ciphertext.startsWith("A")
        ? `B${envelope.ciphertext.slice(1)}`
        : `A${envelope.ciphertext.slice(1)}`,
    };
    expect(() => __openOfflineSyncPayloadForTest(tampered, privateKey, "ev-1")).toThrow();
  });

  it("rejects a client public key that is not 32 raw bytes", () => {
    // Node's base64url of 31 random bytes = 42 chars, definitely not a valid X25519 pub.
    const tooShort = Buffer.from(crypto.randomBytes(31))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => sealOfflineSyncPayload(SAMPLE_PAYLOAD, tooShort, "ev-1")).toThrow(
      /must be 32 bytes/,
    );
  });

  it("rejects a client public key that isn't valid base64url", () => {
    expect(() => sealOfflineSyncPayload(SAMPLE_PAYLOAD, "not!base64url!", "ev-1")).toThrow(
      /not base64url/,
    );
  });
});
