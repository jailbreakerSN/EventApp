---
title: Check-in API
status: shipped
last_updated: 2026-04-25
---

# Check-in API

> **Status: shipped**

Base path: `/v1/events/:eventId/`

See also: [QR v4 & offline sync concept](../20-architecture/concepts/qr-v4-and-offline-sync.md)

---

## Live QR scan

```
POST /v1/events/:eventId/checkin
```

**Auth:** Required  
**Permission:** `checkin:scan` + event access

**Request body:**

```typescript
{
  qrCodeValue: string;             // the full signed QR string
  accessZoneId?: string;           // optional — for access zone enforcement
  scannerDeviceId?: string;        // optional — device attestation
  scannerNonce?: string;           // optional — replay prevention nonce
}
```

**Success response:**

```json
{
  "success": true,
  "data": {
    "registrationId": "reg_abc",
    "participantName": "Fatou Diallo",
    "ticketTypeName": "Entrée générale",
    "checkedInAt": "2026-04-21T10:00:00Z",
    "accessZone": { "id": "zone_vip", "name": "VIP" },
    "scanPolicy": "single",
    "alreadyScanned": false,
    "firstScannerName": null
  }
}
```

**Error cases:**

| HTTP | Code | Meaning |
|---|---|---|
| 422 | `QR_INVALID_SIGNATURE` | Forged or tampered QR code |
| 422 | `QR_NOT_YET_VALID` | Scan before `notBefore − 2h` window |
| 422 | `QR_EXPIRED` | Scan after `notAfter + 2h` window |
| 409 | `QR_ALREADY_USED` | `single` policy — participant already checked in |
| 409 | `ZONE_FULL` | Access zone capacity reached |
| 404 | `REGISTRATION_NOT_FOUND` | QR value not found in database |
| 404 | `EVENT_NOT_FOUND` | Event does not exist |

For `multi_day` policy, re-scanning on the same calendar day returns `QR_ALREADY_USED`. Scanning on a different day succeeds.  
For `multi_zone` policy, re-scanning the same zone returns `QR_ALREADY_USED`. Scanning a different zone succeeds.

---

## Manual check-in

```
POST /v1/events/:eventId/checkin/manual
```

**Auth:** Required  
**Permission:** `checkin:manual` + event access

Check in by registration ID (bypass QR scan — for staff use when QR code is damaged).

**Request body:**
```typescript
{
  registrationId: string;
  accessZoneId?: string;
  reason?: string;                 // logged in audit
}
```

---

## Bulk offline reconciliation

```
POST /v1/events/:eventId/checkin/bulk
```

**Auth:** Required  
**Permission:** `checkin:bulk_reconcile` + event access

Upload an array of offline scans collected when the device was offline. Each scan is processed individually — partial failures do not block the rest.

**Request body:**

```typescript
{
  scans: {
    registrationId: string;
    scannedAt: string;             // ISO 8601 (when the offline scan happened)
    accessZoneId?: string;
    scannerDeviceId?: string;
  }[];
  source: 'offline_sync' | 'kiosk';
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "processed": 15,
    "succeeded": 14,
    "failed": 1,
    "failures": [
      { "registrationId": "reg_xyz", "error": "QR_ALREADY_USED" }
    ]
  }
}
```

---

## Get offline sync data

```
GET /v1/events/:eventId/sync
```

**Auth:** Required  
**Permission:** `checkin:sync_offline` + event access

Returns a complete snapshot of all confirmed registrations for the event.

**Query parameters:**

| Param | Description |
|---|---|
| `encrypted=v1` | Return ECDH-X25519/AES-256-GCM encrypted envelope |
| `clientPublicKey` | Required when `encrypted=v1` — base64url-encoded X25519 public key |

**Plain response:**

```json
{
  "eventId": "...",
  "eventTitle": "Hackathon Dakar 2026",
  "syncedAt": "2026-04-21T08:00:00Z",
  "ttlAt": "2026-04-23T06:00:00Z",
  "totalRegistrations": 87,
  "registrations": [ ... ],
  "accessZones": [ ... ],
  "ticketTypes": [ ... ]
}
```

**Encrypted response:**

```json
{
  "protocol": "ecdh-x25519-aes256gcm-v1",
  "serverPublicKey": "<base64url>",
  "nonce": "<base64url>",
  "ciphertext": "<base64url>",
  "tag": "<base64url>",
  "syncedAt": "...",
  "ttlAt": "..."
}
```

Audit event `checkin.offline_sync.downloaded` is written before the response is returned.

---

## Get check-in log

```
GET /v1/events/:eventId/checkins
```

**Auth:** Required  
**Permission:** `checkin:view_log` + event access

Returns the check-in history for the event with filters.

**Query parameters:** `page`, `limit`, `accessZoneId`, `ticketTypeId`, `search` (participant name)
