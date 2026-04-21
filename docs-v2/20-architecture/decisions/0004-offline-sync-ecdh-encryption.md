# ADR-0004: Offline sync — ECDH-X25519 ephemeral encryption

**Status:** Accepted  
**Date:** 2026-03

---

## Context

The offline sync endpoint (`GET /v1/events/:id/sync`) returns the complete registration list for an event, including every participant's QR code value. This is sensitive data — if a staff member's device is compromised after downloading the snapshot, the attacker could harvest all participant QR codes.

The plain (unencrypted) endpoint was sufficient for MVP, but the Wave 2 security hardening required encryption.

---

## Options considered

| Option | Confidentiality | Forward secrecy | Client implementation complexity |
|---|---|---|---|
| TLS only (no application-layer encryption) | Transport only | No | Zero |
| Symmetric key (AES) with pre-shared key | Yes | No (key compromise = all past compromised) | Low |
| RSA public key encryption | Yes | No | Medium |
| ECDH ephemeral + AES-GCM | Yes | **Yes** | Medium |

Forward secrecy was required because staff devices are physically handled at events — a device could be seized and the key extracted. With forward secrecy, capturing the device after the event does not decrypt the sync payload because the ephemeral server private key was discarded.

---

## Decision

**Use ECDH-X25519 ephemeral key exchange + HKDF-SHA256 + AES-256-GCM with the `eventId` as additional authenticated data (AAD).**

Protocol: `ecdh-x25519-aes256gcm-v1`

---

## Protocol flow

```
Client                                          Server
  │                                               │
  │  Generate ephemeral X25519 keypair (C_priv, C_pub)  │
  │                                               │
  │  GET /sync?encrypted=v1&clientPublicKey=C_pub │
  │ ────────────────────────────────────────────►│
  │                                               │
  │                   Generate ephemeral (S_priv, S_pub)│
  │                   sharedSecret = ECDH(S_priv, C_pub)│
  │                   aesKey = HKDF(sharedSecret, info)  │
  │                   ciphertext = AES-256-GCM(aesKey, nonce, plaintext, aad=eventId)│
  │                   discard S_priv              │
  │                                               │
  │◄────────────────────────────────────────────│
  │  { protocol, S_pub, nonce, ciphertext, tag }  │
  │                                               │
  │  sharedSecret = ECDH(C_priv, S_pub)           │
  │  aesKey = HKDF(sharedSecret, info)            │
  │  plaintext = AES-256-GCM-decrypt(aesKey, ...)  │
  │  discard C_priv                               │
```

---

## Why X25519?

X25519 (Curve25519 Diffie-Hellman) is preferred over ECDH on P-256 because:
- Faster and constant-time by design
- Smaller keys (32 bytes vs 65 bytes for P-256 uncompressed)
- Resistant to several classes of side-channel attacks
- Supported natively in Node.js `crypto` module (no external library)

---

## Security properties

| Property | How achieved |
|---|---|
| Confidentiality | AES-256-GCM encryption |
| Authenticity | AES-GCM authentication tag |
| Forward secrecy | Ephemeral server keypair discarded after response |
| Replay prevention | `eventId` as AAD — ciphertext from event A is rejected when decrypted with event B context |
| Audit | `checkin.offline_sync.downloaded` written before encryption (not after) |

---

## Consequences

- Plain (`GET /sync` without `?encrypted=v1`) remains available for backward compatibility and local development. Production deployments should set a policy to require encryption.
- The Flutter mobile app must implement the client-side ECDH decryption (not yet done — tracked as Wave 9 task).
- The 32-byte client public key must be transmitted as base64url to avoid URL encoding issues.
