import crypto from "node:crypto";
import type { EncryptedSyncEnvelope } from "@teranga/shared-types";

// ─── Offline sync envelope crypto ──────────────────────────────────────────
// ECDH-on-Curve25519 → HKDF-SHA256 → AES-256-GCM. The staff client generates
// an ephemeral X25519 keypair per sync, sends the public half, and derives
// the symmetric key from the server's ephemeral public key on return.
// Neither side persists the private halves, so forward secrecy holds: a
// device compromised later can't decrypt an earlier sync payload from its
// wire trace alone.
//
// The API key (QR_SECRET) is not involved. This envelope protects the
// payload CONFIDENTIALITY only — integrity of the inner QR values still
// comes from the HMAC inside each QR string (v3 format).

const HKDF_INFO = Buffer.from("teranga/offline-sync/v1", "utf8");
const KEY_LEN = 32; // AES-256
const NONCE_LEN = 12; // GCM standard
const CURVE = "x25519";

const b64urlEncode = (b: Buffer): string =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const b64urlDecode = (s: string): Buffer => {
  // Reject non-b64url input early so the caller gets a clear error rather
  // than a downstream DER/PKCS parse failure from importing a bogus key.
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new Error("offline-sync-crypto: input is not base64url");
  }
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
};

/**
 * The raw 32-byte X25519 public key is shipped over the wire; Node's
 * KeyObject APIs want DER / JWK / SPKI. Wrap the raw bytes into the fixed
 * SPKI prefix for id-X25519 so `crypto.createPublicKey` accepts them.
 */
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

function importClientPublicKey(rawB64url: string): crypto.KeyObject {
  const raw = b64urlDecode(rawB64url);
  if (raw.length !== 32) {
    throw new Error(`offline-sync-crypto: client public key must be 32 bytes, got ${raw.length}`);
  }
  return crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function exportServerPublicKeyRaw(keyPair: crypto.KeyPairKeyObjectResult): string {
  const der = keyPair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  // Strip the 12-byte SPKI prefix back off — clients expect the bare 32-byte
  // key, same shape they submitted.
  return b64urlEncode(der.subarray(X25519_SPKI_PREFIX.length));
}

/**
 * Seal a JSON-serialisable payload with ECDH-X25519-HKDF-AES256GCM.
 *
 * `aad` is the event id — the GCM auth tag covers it, so a ciphertext
 * exfiltrated from event A cannot be replayed as event B's payload.
 */
export function sealOfflineSyncPayload(
  plaintext: unknown,
  clientPublicKeyB64url: string,
  aad: string,
): Omit<EncryptedSyncEnvelope, "eventId" | "syncedAt" | "ttlAt" | "protocol"> & {
  protocol: "ecdh-x25519-aes256gcm-v1";
} {
  const clientPub = importClientPublicKey(clientPublicKeyB64url);
  const serverPair = crypto.generateKeyPairSync(CURVE);

  const sharedSecret = crypto.diffieHellman({
    privateKey: serverPair.privateKey,
    publicKey: clientPub,
  });

  // HKDF-SHA256. Node's `hkdfSync` returns an ArrayBuffer.
  const derivedKey = Buffer.from(
    crypto.hkdfSync("sha256", sharedSecret, Buffer.alloc(0), HKDF_INFO, KEY_LEN),
  );

  const nonce = crypto.randomBytes(NONCE_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const jsonBytes = Buffer.from(JSON.stringify(plaintext), "utf8");
  const ciphertext = Buffer.concat([cipher.update(jsonBytes), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    protocol: "ecdh-x25519-aes256gcm-v1",
    serverPublicKey: exportServerPublicKeyRaw(serverPair),
    nonce: b64urlEncode(nonce),
    ciphertext: b64urlEncode(ciphertext),
    tag: b64urlEncode(tag),
  };
}

// Exposed for tests only — a reference decrypt that mirrors what the client
// does. Never called from production code paths.
export function __openOfflineSyncPayloadForTest(
  envelope: { serverPublicKey: string; nonce: string; ciphertext: string; tag: string },
  clientPrivateKey: crypto.KeyObject,
  aad: string,
): unknown {
  const serverPub = importClientPublicKey(envelope.serverPublicKey);
  const sharedSecret = crypto.diffieHellman({
    privateKey: clientPrivateKey,
    publicKey: serverPub,
  });
  const derivedKey = Buffer.from(
    crypto.hkdfSync("sha256", sharedSecret, Buffer.alloc(0), HKDF_INFO, KEY_LEN),
  );
  const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, b64urlDecode(envelope.nonce));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(b64urlDecode(envelope.tag));
  const plain = Buffer.concat([
    decipher.update(b64urlDecode(envelope.ciphertext)),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8"));
}

/** Test-only helper: generate an X25519 keypair and return the raw b64url pub. */
export function __generateClientKeyPairForTest(): {
  privateKey: crypto.KeyObject;
  publicKeyRaw: string;
} {
  const pair = crypto.generateKeyPairSync(CURVE);
  return {
    privateKey: pair.privateKey,
    publicKeyRaw: exportServerPublicKeyRaw(pair),
  };
}
