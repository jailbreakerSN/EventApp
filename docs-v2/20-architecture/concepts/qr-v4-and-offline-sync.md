# QR v4 Signing & Offline Sync Encryption

> **Status: shipped** — QR v4 is the default for all new events. Offline sync encryption is available on request (`?encrypted=v1`).

---

## Why this matters

Teranga's core value is reliable check-in with intermittent connectivity. The security model must guarantee two things even offline:

1. A badge from Event A cannot be used to check in to Event B.
2. If the offline registration snapshot is stolen, it cannot be decrypted without the ephemeral key.

Both guarantees are provided by the cryptographic schemes described here.

---

## QR code format

A QR code value is a colon-delimited string:

```
v4: registrationId:eventId:userId:notBeforeBase36:notAfterBase36:qrKid:hmacSignature
v3: registrationId:eventId:userId:notBeforeBase36:notAfterBase36:hmacSignature
v2: registrationId:eventId:userId:epochBase36:hmacSignature
v1: registrationId:eventId:userId:hmacSignature
```

The scanner detects the version by part count (7 = v4, 6 = v3, 5 = v2, 4 = v1). All four versions are accepted for backward compatibility.

---

## QR v4 — HKDF-based per-event key derivation

### Key generation at event creation

When an event is created, a `qrKid` (key ID) is minted:

```typescript
// apps/api/src/services/qr-signing.ts
function generateEventKid(): string {
  return randomBytes(4).toString('base64url').slice(0, 8); // 8-char base36-safe id
}
```

The `qrKid` is stored on the event document and is **immutable** — enforced by Firestore rules.

### Key derivation at badge generation

When a badge is generated, the signing key is derived:

```typescript
const derivedKey = await hkdf(
  'sha256',
  Buffer.from(QR_MASTER_SECRET, 'utf8'),   // master secret from env
  Buffer.alloc(0),                           // no salt
  `teranga/qr/v4/${event.qrKid}`,           // info string — event-specific
  32                                         // 256-bit key
);
```

This means every event has a unique signing key, even though there is only one master secret.

### Signing

```typescript
const payload = [registrationId, eventId, userId, notBeforeBase36, notAfterBase36, qrKid].join(':');
const signature = createHmac('sha256', derivedKey).update(payload).digest('hex'); // 64-char hex
const qrCodeValue = `${payload}:${signature}`;
```

### Verification at scan time

```typescript
// 1. Parse the QR value
const parts = qrCodeValue.split(':');
const [regId, evId, uid, nbB36, naB36, kid, sig] = parts; // v4

// 2. Look up the event to get qrKid (or qrKidHistory for rotated keys)
const validKids = [event.qrKid, ...(event.qrKidHistory ?? []).map(h => h.kid)];
if (!validKids.includes(kid)) throw new QrInvalidSignatureError();

// 3. Re-derive the key using the kid from the QR value
const derivedKey = await hkdf('sha256', QR_MASTER_SECRET, '', `teranga/qr/v4/${kid}`, 32);

// 4. Re-compute the expected signature
const expectedPayload = [regId, evId, uid, nbB36, naB36, kid].join(':');
const expectedSig = createHmac('sha256', derivedKey).update(expectedPayload).digest('hex');

// 5. Constant-time comparison (prevents timing attacks)
if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
  throw new QrInvalidSignatureError();
}

// 6. Check validity window with clock-skew grace
const notBefore = parseInt(nbB36, 36);
const notAfter = parseInt(naB36, 36);
const TWO_HOURS = 2 * 60 * 60 * 1000;
if (Date.now() < notBefore - TWO_HOURS) throw new QrNotYetValidError();
if (Date.now() > notAfter + TWO_HOURS) throw new QrExpiredError();
```

### Key rotation

When an organizer rotates the QR key:

1. New `qrKid` is generated.
2. Old kid is pushed to `event.qrKidHistory` with a `retiredAt` timestamp.
3. **Already-issued badges continue to work** during the overlap window — the scanner checks both the current `qrKid` and all entries in `qrKidHistory`.
4. New badges use the new kid.

```
POST /v1/events/:eventId/qr-key/rotate
```

---

## Offline sync encryption

### Why encrypt the sync payload?

The sync payload contains every participant's registration data and QR code values. If a staff member's device is compromised, an attacker could use the unencrypted payload to forge check-ins or harvest participant data. Encryption ensures the payload is useless without the ephemeral key.

### Protocol: ECDH-X25519 + HKDF + AES-256-GCM

The scheme is forward-secret: even if the server's private key is later compromised, previously captured ciphertexts cannot be decrypted because the ephemeral keypairs are discarded.

**Request:**

```
GET /v1/events/:id/sync?encrypted=v1&clientPublicKey=<base64url-spki>
```

The client generates an ephemeral X25519 keypair and sends the public key.

**Server-side encryption:**

```typescript
// 1. Generate ephemeral server keypair
const { privateKey: serverPriv, publicKey: serverPub } = generateKeyPairSync('x25519');

// 2. ECDH shared secret
const sharedSecret = diffieHellman({ privateKey: serverPriv, publicKey: clientPubKey });

// 3. Derive symmetric key with HKDF
const aesKey = await hkdf('sha256', sharedSecret, '', 'teranga/sync/v1', 32);

// 4. Encrypt payload with AES-256-GCM
const nonce = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', aesKey, nonce);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const authTag = cipher.getAuthTag();

// 5. Return encrypted envelope
return {
  protocol: 'ecdh-x25519-aes256gcm-v1',
  serverPublicKey: serverPub.export({ type: 'spki', format: 'der' }).toString('base64url'),
  nonce: nonce.toString('base64url'),
  ciphertext: ciphertext.toString('base64url'),
  tag: authTag.toString('base64url'),
  syncedAt: new Date().toISOString(),
  ttlAt: event.endDate + 24h,
};
```

**Client-side decryption:**

```typescript
// 1. Re-derive shared secret using client private key + server public key
const sharedSecret = diffieHellman({ privateKey: clientPriv, publicKey: serverPubKey });

// 2. Re-derive AES key (same HKDF parameters as server)
const aesKey = await hkdf('sha256', sharedSecret, '', 'teranga/sync/v1', 32);

// 3. Decrypt
const decipher = createDecipheriv('aes-256-gcm', aesKey, nonce);
decipher.setAuthTag(authTag);
const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
```

The `eventId` is used as AAD (additional authenticated data) in the GCM tag, preventing the ciphertext from being replayed against a different event.

### Audit on download

The `checkin.offline_sync.downloaded` audit event is written **before** the encrypted payload is returned. This ensures the download is logged even if the encryption step fails.

### Sync payload structure (`OfflineSyncDataSchema`)

```typescript
{
  eventId: string;
  organizationId: string;
  eventTitle: string;
  syncedAt: string;           // ISO 8601
  ttlAt: string;              // hint for cache eviction (event.endDate + 24h)
  totalRegistrations: number;
  registrations: {
    registrationId: string;
    participantName: string;
    participantEmail: string;
    ticketTypeName: string;
    qrCodeValue: string;      // the signed QR string
    allowedZoneIds: string[];
  }[];
  accessZones: AccessZone[];
  ticketTypes: TicketType[];
}
```

---

## Legacy QR versions

| Version | Scheme | Status |
|---|---|---|
| v4 | HKDF(QR_MASTER_SECRET, info=`teranga/qr/v4/{kid}`) + HMAC-SHA256 | Current default |
| v3 | HMAC-SHA256(QR_SECRET, payload) with notBefore/notAfter | Legacy, accepted |
| v2 | HMAC-SHA256(QR_SECRET, payload) with epoch timestamp | Legacy, accepted |
| v1 | HMAC-SHA256(QR_SECRET, payload) no timestamp | Legacy, accepted |

For v1/v2 QRs, the scan path backfills the validity window from `event.startDate − 24h` / `event.endDate + 6h`.

---

## Security properties summary

| Property | Mechanism |
|---|---|
| Cross-event replay prevention | Per-event HKDF key derivation — different events use different keys |
| Timing attack prevention | `crypto.timingSafeEqual` for signature comparison |
| Validity window | `notBefore` / `notAfter` with 2h clock-skew grace |
| Key rotation without badge invalidation | `qrKidHistory` on event doc |
| Offline sync confidentiality | ECDH-X25519 ephemeral keypairs + AES-256-GCM |
| Forward secrecy | Ephemeral server keypair discarded after response |
| Replay prevention (sync) | `eventId` as AES-GCM AAD |
