import { z } from "zod";

export const BadgeTemplateSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  width: z.number().default(85.6), // mm — standard card size
  height: z.number().default(54.0), // mm
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#FFFFFF"),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#1A1A2E"),
  logoURL: z.string().url().nullable().optional(),
  showQR: z.boolean().default(true),
  showName: z.boolean().default(true),
  showOrganization: z.boolean().default(true),
  showRole: z.boolean().default(true),
  showPhoto: z.boolean().default(false),
  customFields: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        position: z.object({ x: z.number(), y: z.number() }),
        fontSize: z.number().default(12),
        color: z.string().default("#000000"),
      }),
    )
    .default([]),
  isDefault: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type BadgeTemplate = z.infer<typeof BadgeTemplateSchema>;

export const BadgeStatusSchema = z.enum(["pending", "generated", "failed"]);
export type BadgeStatus = z.infer<typeof BadgeStatusSchema>;

export const GeneratedBadgeSchema = z.object({
  id: z.string(),
  registrationId: z.string(),
  eventId: z.string(),
  userId: z.string(),
  templateId: z.string(),
  status: BadgeStatusSchema.default("pending"),
  pdfURL: z.string().url().nullable().optional(), // Cloud Storage URL
  qrCodeValue: z.string(), // payload encoded in QR
  error: z.string().nullable().optional(), // error message if generation failed
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
  // Staff-device cache TTL hint — `event.endDate + 24 h`. Devices should
  // auto-purge the cached payload after this timestamp so a lost phone
  // doesn't carry live QRs forever.
  ttlAt: z.string().datetime().optional(),
  registrations: z.array(
    z.object({
      qrCodeValue: z.string(),
      registrationId: z.string(),
      participantName: z.string(),
      ticketTypeId: z.string(),
      ticketTypeName: z.string(),
      accessZoneIds: z.array(z.string()),
      status: z.enum(["confirmed", "waitlisted"]),
      checkedIn: z.boolean(),
      checkedInAt: z.string().datetime().nullable(),
    }),
  ),
});

export type OfflineEventData = z.infer<typeof OfflineEventDataSchema>;

// ─── Badge Template CRUD ─────────────────────────────────────────────────────

export const CreateBadgeTemplateSchema = BadgeTemplateSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateBadgeTemplateDto = z.infer<typeof CreateBadgeTemplateSchema>;

export const UpdateBadgeTemplateSchema = CreateBadgeTemplateSchema.partial().omit({
  organizationId: true,
});

export type UpdateBadgeTemplateDto = z.infer<typeof UpdateBadgeTemplateSchema>;

// ─── Badge Generation Request ────────────────────────────────────────────────

export const BadgeGenerateRequestSchema = z.object({
  registrationId: z.string(),
  templateId: z.string().optional(),
});

export type BadgeGenerateRequest = z.infer<typeof BadgeGenerateRequestSchema>;

export const BulkBadgeGenerateRequestSchema = z.object({
  eventId: z.string(),
  templateId: z.string().optional(),
});

export type BulkBadgeGenerateRequest = z.infer<typeof BulkBadgeGenerateRequestSchema>;

// ─── Upload URL Request ──────────────────────────────────────────────────────

export const UploadUrlRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]),
  purpose: z.enum(["cover", "banner", "logo", "photo", "slides", "document", "feed"]),
});

export type UploadUrlRequest = z.infer<typeof UploadUrlRequestSchema>;

export const UploadUrlResponseSchema = z.object({
  uploadUrl: z.string().url(),
  publicUrl: z.string().url(),
  /**
   * Max bytes the signed URL will accept. Clients should use this to
   * reject oversize files client-side BEFORE issuing the PUT (faster
   * UX), but the ultimate enforcement lives on the server via the
   * signed `x-goog-content-length-range` header.
   */
  maxBytes: z.number().int().positive(),
  /**
   * Headers the client MUST include on the PUT request. The server
   * signs these headers into the upload URL — if the client omits
   * them, GCS returns 403 `SignatureDoesNotMatch`. Merge these with
   * any other headers (e.g. Content-Type) the PUT already sends.
   */
  requiredHeaders: z.record(z.string()),
});

export type UploadUrlResponse = z.infer<typeof UploadUrlResponseSchema>;
