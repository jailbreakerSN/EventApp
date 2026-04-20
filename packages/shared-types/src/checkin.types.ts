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
});

export type OfflineSyncData = z.infer<typeof OfflineSyncDataSchema>;

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
