---
title: Run Your First Check-In (QR + Offline Sync)
status: shipped
last_updated: 2026-04-25
---

# Run Your First Check-In (QR + Offline Sync)

> **Status: shipped** — QR v4 signing and offline sync are fully implemented.

This tutorial covers the **offline check-in flow** that is Teranga's core differentiator: a staff member downloads an encrypted registration snapshot, goes offline, scans QR codes, and later reconciles results back to the server.

---

## Two check-in modes

| Mode | When to use | API endpoint |
|---|---|---|
| **Live scan** | Stable internet at the venue | `POST /v1/events/:id/checkin` |
| **Offline sync** | Intermittent or no connectivity | Download snapshot → scan locally → `POST /v1/events/:id/checkin/bulk` |

Both modes use the same QR code format and the same signature verification.

---

## Live scan

With emulators running and a published event with at least one confirmed registration:

```bash
# Get the registration's QR code value (from Firestore emulator or seed data)
QR_VALUE="<qrCodeValue from registration doc>"

curl -X POST http://localhost:3000/v1/events/<eventId>/checkin \
  -H "Authorization: Bearer <staff_firebase_id_token>" \
  -H "Content-Type: application/json" \
  -d '{"qrCodeValue": "'"$QR_VALUE"'", "scannerDeviceId": "dev-laptop"}'
```

Successful response:

```json
{
  "success": true,
  "data": {
    "registrationId": "...",
    "participantName": "Fatou Diallo",
    "ticketTypeName": "Entrée générale",
    "checkedInAt": "2026-04-21T10:00:00.000Z",
    "accessZone": null,
    "scanPolicy": "single",
    "alreadyScanned": false
  }
}
```

Error responses:

| Code | Meaning |
|---|---|
| `QR_INVALID_SIGNATURE` | Tampered or forged QR code |
| `QR_NOT_YET_VALID` | Scan is before the `notBefore` window |
| `QR_EXPIRED` | Scan is after the `notAfter` window |
| `QR_ALREADY_USED` | Single-entry policy; participant already checked in |
| `ZONE_FULL` | Access zone capacity reached |
| `REGISTRATION_NOT_FOUND` | QR value not in database |

---

## Offline sync

### Step 1 — Download the snapshot

```bash
# Plain (unencrypted)
curl http://localhost:3000/v1/events/<eventId>/sync \
  -H "Authorization: Bearer <staff_token>" \
  > sync-data.json

# Encrypted (recommended for production)
# Generate ephemeral X25519 keypair (example with Node)
node -e "
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('x25519');
const pub = publicKey.export({ type: 'spki', format: 'der' });
console.log(Buffer.from(pub).toString('base64url'));
"
# Then:
curl "http://localhost:3000/v1/events/<eventId>/sync?encrypted=v1&clientPublicKey=<base64url_pub_key>" \
  -H "Authorization: Bearer <staff_token>" \
  > encrypted-sync.json
```

The snapshot contains every `confirmed` registration's `qrCodeValue`, name, ticket type, and allowed access zones — everything the scanner needs to verify offline. See [QR v4 & offline sync concept](../20-architecture/concepts/qr-v4-and-offline-sync.md) for the encryption details.

### Step 2 — Scan offline

The Flutter staff app caches this snapshot in Hive. When the device is offline, it verifies each scanned QR against the local cache (signature check + notBefore/notAfter window). Scans are queued locally.

### Step 3 — Reconcile (bulk upload)

When connectivity is restored:

```bash
curl -X POST http://localhost:3000/v1/events/<eventId>/checkin/bulk \
  -H "Authorization: Bearer <staff_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "scans": [
      { "registrationId": "reg_abc", "scannedAt": "2026-04-21T10:05:00Z", "scannerDeviceId": "device-1" },
      { "registrationId": "reg_def", "scannedAt": "2026-04-21T10:06:00Z", "scannerDeviceId": "device-1" }
    ],
    "source": "offline_sync"
  }'
```

Response:

```json
{
  "success": true,
  "data": {
    "processed": 2,
    "succeeded": 2,
    "failed": 0,
    "failures": []
  }
}
```

---

## Scan policies

The event owner can set a scan policy via `POST /v1/events/:id/scan-policy`:

| Policy | Behaviour | Plan requirement |
|---|---|---|
| `single` | One scan per registration, ever | Free |
| `multi_day` | One scan per registration per calendar day | Pro (`advancedAnalytics`) |
| `multi_zone` | One scan per registration per access zone | Pro (`advancedAnalytics`) |

---

## Testing QR validity windows

The QR value includes `notBefore` and `notAfter` timestamps (base36-encoded milliseconds). The scanner rejects QRs that are outside `[notBefore − 2h, notAfter + 2h]` (clock-skew grace period).

In local dev, all seeded badges use `notBefore = event.startDate − 24h` and `notAfter = event.endDate + 6h`. If your test event is in the future, the QR will fail with `QR_NOT_YET_VALID` until `now >= notBefore − 2h`.

To override for testing, use the Firestore emulator UI to edit the badge's `notBefore`/`notAfter` fields directly.

---

## Further reading

- [QR v4 architecture concept](../20-architecture/concepts/qr-v4-and-offline-sync.md) — full cryptographic design
- [Check-in API reference](../30-api/checkins.md) — all endpoint details
- [Security checklist](../60-contributing/security-checklist.md) — hardening rules for the scan path
