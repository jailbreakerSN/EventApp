import { z } from "zod";
import { RegistrationStatusSchema } from "./event.types";

// ─── Offline Sync ─────────────────────────────────────────────────────────────

export const OfflineSyncRegistrationSchema = z.object({
  id: z.string(),
  qrCodeValue: z.string(),
  userId: z.string(),
  participantName: z.string().nullable(),
  participantEmail: z.string().nullable(),
  ticketTypeId: z.string(),
  ticketTypeName: z.string(),
  status: RegistrationStatusSchema,
  accessZoneIds: z.array(z.string()),
  checkedIn: z.boolean(),
  checkedInAt: z.string().datetime().nullable(),
});

export type OfflineSyncRegistration = z.infer<typeof OfflineSyncRegistrationSchema>;

export const OfflineSyncDataSchema = z.object({
  eventId: z.string(),
  organizationId: z.string(),
  eventTitle: z.string(),
  syncedAt: z.string().datetime(),
  totalRegistrations: z.number().int(),
  registrations: z.array(OfflineSyncRegistrationSchema),
  accessZones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
      capacity: z.number().int().positive().nullable().optional(),
    }),
  ),
  ticketTypes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
  ),
  // Client-side cache TTL hint. Staff devices should auto-purge the cached
  // payload after this timestamp (`event.endDate + 24 h` by default). Shipped
  // in the plaintext response and as a cleartext field on the encrypted
  // envelope so clients can schedule the purge without having to decrypt.
  ttlAt: z.string().datetime(),
});

export type OfflineSyncData = z.infer<typeof OfflineSyncDataSchema>;

// ─── Encrypted sync envelope (opt-in) ──────────────────────────────────────
// Staff devices cache every confirmed registration's signed QR value for
// offline scanning, which makes the offline-sync payload the most sensitive
// blob the API ships. Leaking one staff device = leaking every badge for
// that event.
//
// Opt-in via `?encrypted=v1&clientPublicKey=<b64url-x25519-pub>`. Response
// then carries the same payload sealed with ECDH-on-Curve25519 → HKDF-SHA256
// → AES-256-GCM:
//
//   1. Client generates an ephemeral X25519 keypair at sync time; sends pub.
//   2. Server generates its own ephemeral X25519 keypair.
//   3. Shared secret = ECDH(server_priv, client_pub).
//   4. AES key = HKDF-SHA256(shared_secret, salt=none, info="teranga/sync/v1").
//   5. ciphertext = AES-256-GCM(key, nonce, plaintext, aad=eventId).
//   6. Client derives the same key with ECDH(client_priv, server_pub) and
//      decrypts. Forward-secret because both keypairs are ephemeral; the
//      API never sees the client's private key.
//
// `ttlAt` stays outside the ciphertext so the client can schedule its
// purge without decrypting (e.g. for a pre-flight fast-path that just
// checks whether the cache is still fresh).
export const EncryptedSyncEnvelopeSchema = z.object({
  protocol: z.literal("ecdh-x25519-aes256gcm-v1"),
  eventId: z.string(),
  serverPublicKey: z.string().regex(/^[A-Za-z0-9_-]+$/, "base64url without padding"),
  nonce: z.string().regex(/^[A-Za-z0-9_-]+$/, "base64url without padding"),
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/, "base64url without padding"),
  tag: z.string().regex(/^[A-Za-z0-9_-]+$/, "base64url without padding"),
  syncedAt: z.string().datetime(),
  ttlAt: z.string().datetime(),
});

export type EncryptedSyncEnvelope = z.infer<typeof EncryptedSyncEnvelopeSchema>;

// ─── Live check-in request body ────────────────────────────────────────────
// Shape for `POST /v1/registrations/checkin`. Lives in shared-types so the
// API layer and any mobile / web client stay in lockstep on the scanner
// attestation optional fields (CLAUDE.md: "All request bodies validated
// with Zod schemas from @teranga/shared-types").
export const CheckInRequestSchema = z.object({
  qrCodeValue: z.string(),
  accessZoneId: z.string().optional(),
  scannerDeviceId: z.string().min(1).max(120).optional(),
  scannerNonce: z
    .string()
    .regex(/^[0-9a-f]{16,64}$/i, "scannerNonce must be 16–64 lowercase hex chars")
    .optional(),
});

export type CheckInRequest = z.infer<typeof CheckInRequestSchema>;

// ─── Per-scan forensic record (checkins collection) ────────────────────────
// Every scan attempt — successful, duplicate, or rejected — writes a row
// here. The existing `registration.status === "checked_in"` / `checkedInAt`
// fields remain as the denormalised "first-ever successful entry" cache;
// this collection adds the forensic trail (device id, nonce, client vs
// server time split, reject reason) that Sprint C item 4.3's security
// dashboard needs.
//
// Shadow-write phase: services write to both `registrations` (legacy
// cache, unchanged semantics) and `checkins` (new forensic log). No
// reader migrates in this commit — that ships in a follow-up.

export const CheckinRecordStatusSchema = z.enum(["success", "duplicate", "rejected"]);
export type CheckinRecordStatus = z.infer<typeof CheckinRecordStatusSchema>;

export const CheckinSourceSchema = z.enum(["live", "offline_sync"]);
export type CheckinSource = z.infer<typeof CheckinSourceSchema>;

/**
 * Maps the per-item bulk-sync outcome enum onto the reject classification
 * we persist. Reused by `BulkCheckinResultStatusSchema` so the two stay
 * in lockstep — any new reject reason added there must land here too.
 */
export const CheckinRejectCodeSchema = z.enum([
  "invalid_qr",
  "not_found",
  "cancelled",
  "invalid_status",
  "zone_full",
  "expired",
  "not_yet_valid",
]);
export type CheckinRejectCode = z.infer<typeof CheckinRejectCodeSchema>;

export const CheckinRecordSchema = z.object({
  id: z.string(),
  registrationId: z.string(),
  eventId: z.string(),
  organizationId: z.string(),
  userId: z.string(),

  // Authoritative server-confirmed timestamp.
  scannedAt: z.string().datetime(),
  // Device-reported scan time. Diverges from `scannedAt` on the
  // `offline_sync` path — the gap is the reconcile lag, which 4.3's
  // anomaly widget flags.
  clientScannedAt: z.string().datetime().nullable(),
  // Staff uid that accepted the scan.
  scannedBy: z.string(),
  scannerDeviceId: z.string().nullable(),
  scannerNonce: z.string().nullable(),
  accessZoneId: z.string().nullable(),

  status: CheckinRecordStatusSchema,
  source: CheckinSourceSchema,
  // Populated for `duplicate` / `rejected` rows; null on `success`.
  rejectCode: CheckinRejectCodeSchema.nullable(),
  reason: z.string().nullable(),

  // Pins which QR credential was scanned. `qrKid` is non-null only for
  // v4 — lets the rotation forensics page show "scan accepted a QR
  // signed by key X rotated Y days ago".
  qrPayloadVersion: z.enum(["v1", "v2", "v3", "v4"]).nullable(),
  qrKid: z.string().nullable(),

  // Request-context breadcrumb so auditLogs + checkins can be joined.
  requestId: z.string().nullable(),
  // Client-supplied idempotency key for offline reconcile bursts;
  // equals `bulkItem.localId` on that path, null on live scans.
  idempotencyKey: z.string().nullable(),

  createdAt: z.string().datetime(),
});

export type CheckinRecord = z.infer<typeof CheckinRecordSchema>;

/**
 * Query-param DTO for `GET /v1/checkin/:eventId/sync`. Both fields are
 * optional — omitting them keeps the legacy plaintext response. Together
 * they opt into the encrypted envelope above.
 */
export const OfflineSyncQuerySchema = z.object({
  encrypted: z.literal("v1").optional(),
  clientPublicKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, "base64url without padding")
    .optional(),
  // Scanner device id for the download audit event (mirrors the attestation
  // pattern added on the scan side). Optional for back-compat.
  scannerDeviceId: z.string().min(1).max(120).optional(),
});

export type OfflineSyncQuery = z.infer<typeof OfflineSyncQuerySchema>;

// ─── Bulk Check-in Sync ──────────────────────────────────────────────────────

// ─── Scanner device attestation ────────────────────────────────────────────
// Every scan (live or offline-queued) should carry the scanner device's
// stable id + a per-scan nonce. Combined with the server-recorded staff
// uid these let the organizer dashboard (Sprint C item 4.3) reconstruct
// "same QR seen on different devices within N minutes" velocity patterns —
// the canonical screenshot-share fraud signature. Both fields are still
// OPTIONAL on the wire so older mobile app builds keep working; the
// server treats missing fields as "unattested".
//
// Constraints:
// - `scannerDeviceId` is a stable per-install identifier generated on
//   first staff login (Flutter: device_info_plus + secure storage;
//   Web: crypto.randomUUID() persisted in IndexedDB). Up to 120 chars
//   to accommodate vendor-specific ids (Apple IDFV, Android SSAID).
// - `scannerNonce` is a fresh per-scan token — a 128-bit CSPRNG value
//   encoded as 32 hex chars. Primarily an audit breadcrumb: two scans
//   with the same nonce from two different devices is a clear replay
//   signal.
export const ScannerAttestationSchema = z.object({
  scannerDeviceId: z.string().min(1).max(120).optional(),
  scannerNonce: z
    .string()
    .regex(/^[0-9a-f]{16,64}$/i, "scannerNonce must be 16–64 lowercase hex chars")
    .optional(),
});

export type ScannerAttestation = z.infer<typeof ScannerAttestationSchema>;

export const BulkCheckinItemSchema = z.object({
  localId: z.string(), // client-generated UUID for dedup
  qrCodeValue: z.string(),
  accessZoneId: z.string().nullable().optional(),
  scannedAt: z.string().datetime(), // device local time
  scannerDeviceId: ScannerAttestationSchema.shape.scannerDeviceId,
  scannerNonce: ScannerAttestationSchema.shape.scannerNonce,
});

export type BulkCheckinItem = z.infer<typeof BulkCheckinItemSchema>;

export const BulkCheckinRequestSchema = z.object({
  items: z.array(BulkCheckinItemSchema).min(1).max(500),
});

export type BulkCheckinRequest = z.infer<typeof BulkCheckinRequestSchema>;

export const BulkCheckinResultStatusSchema = z.enum([
  "success", // checked in successfully
  "already_checked_in", // was already checked in (by another scanner)
  "cancelled", // registration was cancelled — cancel wins
  "invalid_qr", // QR signature invalid
  "not_found", // registration not found
  "invalid_status", // registration in non-checkable status (pending, waitlisted)
  "zone_full", // access zone at capacity
  "expired", // scan happened after the signed validity window (with skew)
  "not_yet_valid", // scan happened before the signed validity window (with skew)
]);

export type BulkCheckinResultStatus = z.infer<typeof BulkCheckinResultStatusSchema>;

export const BulkCheckinResultSchema = z.object({
  localId: z.string(),
  status: BulkCheckinResultStatusSchema,
  registrationId: z.string().nullable(),
  participantName: z.string().nullable().optional(),
  checkedInAt: z.string().datetime().nullable().optional(),
  reason: z.string().nullable().optional(), // human-readable reason for non-success
});

export type BulkCheckinResult = z.infer<typeof BulkCheckinResultSchema>;

export const BulkCheckinResponseSchema = z.object({
  eventId: z.string(),
  processed: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  results: z.array(BulkCheckinResultSchema),
});

export type BulkCheckinResponse = z.infer<typeof BulkCheckinResponseSchema>;

// ─── Check-in Statistics ─────────────────────────────────────────────────────

export const ZoneStatsSchema = z.object({
  zoneId: z.string(),
  zoneName: z.string(),
  checkedIn: z.number().int(),
  capacity: z.number().int().nullable(),
});

export type ZoneStats = z.infer<typeof ZoneStatsSchema>;

export const CheckinStatsSchema = z.object({
  eventId: z.string(),
  totalRegistered: z.number().int(),
  totalCheckedIn: z.number().int(),
  totalPending: z.number().int(),
  totalCancelled: z.number().int(),
  byZone: z.array(ZoneStatsSchema),
  byTicketType: z.array(
    z.object({
      ticketTypeId: z.string(),
      ticketTypeName: z.string(),
      registered: z.number().int(),
      checkedIn: z.number().int(),
    }),
  ),
  lastCheckinAt: z.string().datetime().nullable(),
});

export type CheckinStats = z.infer<typeof CheckinStatsSchema>;

// ─── Access Zone CRUD ────────────────────────────────────────────────────────

export const CreateAccessZoneSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a hex color (#RRGGBB)"),
  allowedTicketTypes: z.array(z.string()).default([]),
  capacity: z.number().int().positive().nullable().optional(),
});

export type CreateAccessZoneDto = z.infer<typeof CreateAccessZoneSchema>;

export const UpdateAccessZoneSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  allowedTicketTypes: z.array(z.string()).optional(),
  capacity: z.number().int().positive().nullable().optional(),
});

export type UpdateAccessZoneDto = z.infer<typeof UpdateAccessZoneSchema>;

// ─── Manual Check-in Search ─────────────────────────────────────────────────

export const ManualCheckinSearchSchema = z.object({
  q: z.string().min(2).max(200), // search by name or email
  limit: z.coerce.number().int().positive().max(20).default(10),
});

export type ManualCheckinSearch = z.infer<typeof ManualCheckinSearchSchema>;

// ─── Check-in History ───────────────────────────────────────────────────────

export const CheckinLogEntrySchema = z.object({
  registrationId: z.string(),
  participantName: z.string().nullable(),
  participantEmail: z.string().nullable(),
  ticketTypeName: z.string(),
  accessZoneName: z.string().nullable(),
  checkedInAt: z.string().datetime(),
  checkedInBy: z.string(),
  staffName: z.string().nullable(),
  source: z.enum(["live", "offline_sync"]),
});

export type CheckinLogEntry = z.infer<typeof CheckinLogEntrySchema>;

export const CheckinHistoryQuerySchema = z.object({
  q: z.string().max(200).optional(),
  accessZoneId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CheckinHistoryQuery = z.infer<typeof CheckinHistoryQuerySchema>;
