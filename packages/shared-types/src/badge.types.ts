import { z } from "zod";

export const BadgeTemplateSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  width: z.number().default(85.6),   // mm — standard card size
  height: z.number().default(54.0),  // mm
  backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#FFFFFF"),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#1A1A2E"),
  logoURL: z.string().url().nullable().optional(),
  showQR: z.boolean().default(true),
  showName: z.boolean().default(true),
  showOrganization: z.boolean().default(true),
  showRole: z.boolean().default(true),
  showPhoto: z.boolean().default(false),
  customFields: z.array(z.object({
    key: z.string(),
    label: z.string(),
    position: z.object({ x: z.number(), y: z.number() }),
    fontSize: z.number().default(12),
    color: z.string().default("#000000"),
  })).default([]),
  isDefault: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type BadgeTemplate = z.infer<typeof BadgeTemplateSchema>;

export const GeneratedBadgeSchema = z.object({
  id: z.string(),
  registrationId: z.string(),
  eventId: z.string(),
  userId: z.string(),
  templateId: z.string(),
  pdfURL: z.string().url().nullable().optional(),   // Cloud Storage URL
  qrCodeValue: z.string(),                          // payload encoded in QR
  generatedAt: z.string().datetime(),
  downloadCount: z.number().int().default(0),
});

export type GeneratedBadge = z.infer<typeof GeneratedBadgeSchema>;

// ─── QR Scan Result ───────────────────────────────────────────────────────────

export const QrScanResultSchema = z.object({
  valid: z.boolean(),
  registrationId: z.string().nullable(),
  participantName: z.string().nullable(),
  ticketType: z.string().nullable(),
  accessZone: z.string().nullable(),
  alreadyCheckedIn: z.boolean(),
  checkedInAt: z.string().datetime().nullable(),
  reason: z.string().nullable(), // error reason if invalid
});

export type QrScanResult = z.infer<typeof QrScanResultSchema>;

// ─── Offline Sync Payload ─────────────────────────────────────────────────────
// Downloaded by staff app before going offline

export const OfflineEventDataSchema = z.object({
  eventId: z.string(),
  downloadedAt: z.string().datetime(),
  registrations: z.array(z.object({
    qrCodeValue: z.string(),
    registrationId: z.string(),
    participantName: z.string(),
    ticketTypeId: z.string(),
    ticketTypeName: z.string(),
    accessZoneIds: z.array(z.string()),
    status: z.enum(["confirmed", "waitlisted"]),
    checkedIn: z.boolean(),
    checkedInAt: z.string().datetime().nullable(),
  })),
});

export type OfflineEventData = z.infer<typeof OfflineEventDataSchema>;
