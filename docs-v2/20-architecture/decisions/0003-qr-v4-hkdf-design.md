# ADR-0003: QR v4 — HKDF-based per-event key derivation

**Status:** Accepted  
**Date:** 2026-03  
**Supersedes:** QR v3 (global QR_SECRET)

---

## Context

QR v3 used a single global secret (`QR_SECRET`) for all events:

```
signature = HMAC-SHA256(QR_SECRET, payload)
```

This has a critical vulnerability: a valid QR code from Event A can be replayed at Event B if both events share the same organizer (and therefore the same `QR_SECRET`). This was identified during the Wave 1 security review.

Additionally, there was no clean key rotation mechanism — rotating `QR_SECRET` would invalidate all previously issued badges instantly.

---

## Decision

**Adopt per-event key derivation using HKDF-SHA256 (QR v4).** Each event gets a unique `qrKid`. The signing key is derived as:

```
signingKey = HKDF-SHA256(QR_MASTER_SECRET, salt=none, info="teranga/qr/v4/{qrKid}")
```

The QR payload includes `qrKid` so the verifier knows which derived key to use.

---

## Why HKDF vs alternatives

| Option | Cross-event isolation | Key rotation | Key distribution overhead |
|---|---|---|---|
| Global shared secret (v3) | ❌ No | ❌ All-or-nothing | Zero |
| Per-event random key stored in Firestore | ✅ Yes | ✅ Per event | High (key lookup on every scan) |
| Per-event key via HKDF from master | ✅ Yes | ✅ Per event (kid rotation) | Zero (deterministic re-derivation) |

HKDF is the right choice because:
1. **Isolation without storage** — the derived key is deterministic. The scanner can re-derive it on the fly. No Firestore read needed for the signing key.
2. **Master secret rotation is clean** — new master → new kid → new key. Old badges (old kid, old master) still verify using the old derived key as long as the old master is kept in a rotation buffer.
3. **Standard** — HKDF (RFC 5869) is well-understood. No novel cryptography.

---

## Key rotation mechanism

When an organizer rotates the QR key for an event:
1. A new `qrKid` is minted.
2. The old `{kid, retiredAt}` is pushed to `event.qrKidHistory`.
3. **Old badges continue to verify** — the scanner checks `event.qrKid` and all entries in `event.qrKidHistory`.
4. New badges use the new kid.

`qrKidHistory` is enforced as immutable in Firestore rules — entries cannot be removed, preventing a malicious actor from invalidating rotated badges.

---

## Backward compatibility

v1/v2/v3 QR codes are still accepted. The scanner detects the version by part count. For v1/v2/v3, the global `QR_SECRET` is used for verification (legacy path). New events always issue v4.

---

## Consequences

- Two environment variables are now required: `QR_SECRET` (for v1/v2/v3 legacy) and `QR_MASTER_SECRET` (for v4).
- Losing `QR_MASTER_SECRET` invalidates all v4 badges issued with it. It must be stored in Secret Manager.
- The `info` string `"teranga/qr/v4/{kid}"` is permanent and must never change — doing so would invalidate all issued v4 badges.
