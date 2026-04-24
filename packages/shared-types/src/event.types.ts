import { z } from "zod";
import { zStringBoolean } from "./utils/zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const EventStatusSchema = z.enum([
  "draft",
  "published",
  "cancelled",
  "completed",
  "archived",
]);

export type EventStatus = z.infer<typeof EventStatusSchema>;

export const EventFormatSchema = z.enum(["in_person", "online", "hybrid"]);

export type EventFormat = z.infer<typeof EventFormatSchema>;

export const EventCategorySchema = z.enum([
  "conference",
  "workshop",
  "concert",
  "festival",
  "networking",
  "sport",
  "exhibition",
  "ceremony",
  "training",
  "other",
]);

export type EventCategory = z.infer<typeof EventCategorySchema>;

// ─── Location ─────────────────────────────────────────────────────────────────

export const LocationSchema = z.object({
  name: z.string(),
  address: z.string(),
  city: z.string(),
  country: z.string().length(2).default("SN"),
  coordinates: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
  googleMapsUrl: z.string().url().optional(),
  streamUrl: z.string().url().optional(), // for online/hybrid events
});

export type Location = z.infer<typeof LocationSchema>;

// ─── Access Zone ──────────────────────────────────────────────────────────────

export const AccessZoneSchema = z.object({
  id: z.string(),
  name: z.string(), // e.g. "VIP", "General", "Press"
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), // hex color for badge
  allowedTicketTypes: z.array(z.string()),
  capacity: z.number().int().positive().nullable().optional(),
});

export type AccessZone = z.infer<typeof AccessZoneSchema>;

// ─── Session / Agenda Item ────────────────────────────────────────────────────

export const SessionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  title: z.string().min(2).max(200),
  description: z.string().max(2000).nullable().optional(),
  speakerIds: z.array(z.string()).default([]),
  location: z.string().nullable().optional(), // room/stage name
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  tags: z.array(z.string()).default([]),
  streamUrl: z.string().url().nullable().optional(),
  isBookmarkable: z.boolean().default(true),
  deletedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Session = z.infer<typeof SessionSchema>;

export const CreateSessionSchema = SessionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateSessionDto = z.infer<typeof CreateSessionSchema>;

export const UpdateSessionSchema = CreateSessionSchema.partial().omit({
  eventId: true,
});

export type UpdateSessionDto = z.infer<typeof UpdateSessionSchema>;

// ─── Session Bookmark ────────────────────────────────────────────────────────

export const SessionBookmarkSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  eventId: z.string(),
  userId: z.string(),
  createdAt: z.string().datetime(),
});

export type SessionBookmark = z.infer<typeof SessionBookmarkSchema>;

// ─── Session Schedule Query ──────────────────────────────────────────────────

export const SessionScheduleQuerySchema = z.object({
  date: z.string().optional(), // YYYY-MM-DD filter
  speakerId: z.string().optional(),
  location: z.string().optional(), // room/stage filter
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type SessionScheduleQuery = z.infer<typeof SessionScheduleQuerySchema>;

// ─── Ticket Type ──────────────────────────────────────────────────────────────

export const TicketTypeSchema = z.object({
  id: z.string(),
  name: z.string(), // e.g. "VIP", "Standard", "Press"
  description: z.string().optional(),
  price: z.number().int().min(0).default(0), // XOF — no decimals, 0 = free
  currency: z.enum(["XOF", "EUR", "USD"]).default("XOF"), // XOF = CFA Franc
  totalQuantity: z.number().int().positive().nullable(), // null = unlimited
  soldCount: z.number().int().default(0),
  accessZoneIds: z.array(z.string()).default([]),
  saleStartDate: z.string().datetime().nullable().optional(),
  saleEndDate: z.string().datetime().nullable().optional(),
  isVisible: z.boolean().default(true),
});

export type TicketType = z.infer<typeof TicketTypeSchema>;

// ─── Event ────────────────────────────────────────────────────────────────────

export const EventSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  title: z.string().min(3).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().max(10000),
  shortDescription: z.string().max(300).nullable().optional(),
  coverImageURL: z.string().url().nullable().optional(),
  bannerImageURL: z.string().url().nullable().optional(),
  category: EventCategorySchema,
  tags: z.array(z.string()).default([]),
  format: EventFormatSchema.default("in_person"),
  status: EventStatusSchema.default("draft"),
  location: LocationSchema,
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  timezone: z.string().default("Africa/Dakar"),
  ticketTypes: z.array(TicketTypeSchema).default([]),
  accessZones: z.array(AccessZoneSchema).default([]),
  maxAttendees: z.number().int().positive().nullable().optional(),
  registeredCount: z.number().int().default(0),
  checkedInCount: z.number().int().default(0),
  isPublic: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  venueId: z.string().nullable().optional(),
  venueName: z.string().nullable().optional(), // denormalized from Venue
  requiresApproval: z.boolean().default(false), // waitlist feature
  // Scan policy — governs when a second scan of the same badge is allowed.
  //   "single"     : one scan per registration, period. Second scan →
  //                  duplicate (current behaviour, safe default).
  //   "multi_day"  : one scan per registration per calendar day in the
  //                  event's timezone. Enables 3-day festivals.
  //   "multi_zone" : one scan per (registration, accessZoneId) pair.
  //                  Enables access → lunch → afterparty gating.
  // A new scan that would exceed the policy is persisted as a duplicate
  // in the `checkins` collection but does not flip the registration
  // status again; first-ever successful scan remains the canonical
  // "checked in" event for counters + analytics.
  scanPolicy: z.enum(["single", "multi_day", "multi_zone"]).default("single"),
  templateId: z.string().nullable().optional(), // created from a template
  createdBy: z.string(), // Firebase UID
  updatedBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable().optional(),
  // ─── v4 QR signing key id ───────────────────────────────────────────────
  // Opaque 8-char base36 identifier used by HKDF as part of the per-event
  // HMAC key derivation: `key = HKDF(QR_MASTER, salt=eventId,
  // info="teranga/qr/v4/${qrKid}")`. Rotated via
  // `event.service.ts#rotateQrKey`; the retired value rides on
  // `qrKidHistory` so already-issued badges keep verifying during the
  // rotation window. Optional so legacy events that still sign v3 QRs
  // don't fail validation at the schema layer.
  qrKid: z
    .string()
    .regex(/^[0-9a-z]{4,16}$/)
    .nullable()
    .optional(),
  qrKidHistory: z
    .array(
      z.object({
        kid: z.string().regex(/^[0-9a-z]{4,16}$/),
        retiredAt: z.string().datetime(),
      }),
    )
    .default([]),
});

export type Event = z.infer<typeof EventSchema>;

export const CreateEventSchema = EventSchema.omit({
  id: true,
  slug: true,
  registeredCount: true,
  checkedInCount: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  // QR signing metadata is server-owned — organizers don't set it on
  // create, and they can't edit it via the generic update path either.
  // Rotation lives behind a dedicated service method.
  qrKid: true,
  qrKidHistory: true,
  // `scanPolicy` is also server-owned at create time (defaults to
  // "single"); organizers flip it via a dedicated `setScanPolicy`
  // service method once the event is live.
  scanPolicy: true,
});

export type CreateEventDto = z.infer<typeof CreateEventSchema>;

export const UpdateEventSchema = CreateEventSchema.partial().omit({
  organizationId: true,
});

export type UpdateEventDto = z.infer<typeof UpdateEventSchema>;

// ─── Scan policy request ───────────────────────────────────────────────────
// Body schema for `POST /v1/events/:eventId/scan-policy`. Kept in
// shared-types so the backoffice policy-picker and the API agree on the
// enum shape. `multi_day` / `multi_zone` are plan-gated (advancedAnalytics)
// server-side — the Zod schema alone does not enforce that.
export const SetScanPolicySchema = z.object({
  policy: z.enum(["single", "multi_day", "multi_zone"]),
});

export type SetScanPolicyDto = z.infer<typeof SetScanPolicySchema>;

// ─── Registration ─────────────────────────────────────────────────────────────

export const RegistrationStatusSchema = z.enum([
  "pending", // awaiting approval (requiresApproval = true)
  "pending_payment", // awaiting payment for paid tickets
  "confirmed",
  "waitlisted",
  "cancelled",
  "checked_in",
]);

export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export const RegistrationSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  ticketTypeId: z.string(),
  eventTitle: z.string().optional(), // denormalized for display
  eventSlug: z.string().optional(), // denormalized so client can build /events/:slug links without a second fetch
  eventStartDate: z.string().datetime().optional(), // denormalized for calendar view
  eventEndDate: z.string().datetime().optional(), // denormalized for calendar view
  ticketTypeName: z.string().optional(), // denormalized for display
  participantName: z.string().nullable().optional(), // denormalized for display
  participantEmail: z.string().nullable().optional(), // denormalized for display
  status: RegistrationStatusSchema.default("confirmed"),
  qrCodeValue: z.string(), // unique QR payload
  checkedInAt: z.string().datetime().nullable().optional(),
  checkedInBy: z.string().nullable().optional(), // staff uid
  // Device attestation — id of the scanner device that accepted the QR.
  // Optional because older mobile app builds don't send it yet, and the
  // manual-checkin flow (backoffice search) has no device. Stored here
  // for O(1) "who scanned this" lookups; the full audit trail (nonce,
  // server-confirmed timestamp) lives in auditLogs.
  checkedInDeviceId: z.string().nullable().optional(),
  accessZoneId: z.string().nullable().optional(), // zone scanned at
  notes: z.string().nullable().optional(),
  promotedFromWaitlistAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Registration = z.infer<typeof RegistrationSchema>;

// ─── Event Search Query ──────────────────────────────────────────────────────

export const EventSearchQuerySchema = z.object({
  q: z.string().max(200).optional(), // title prefix search
  category: EventCategorySchema.optional(),
  format: EventFormatSchema.optional(),
  city: z.string().optional(),
  country: z.string().length(2).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(), // comma-separated or array
  dateFrom: z.string().datetime().optional(), // events starting on or after
  dateTo: z.string().datetime().optional(), // events starting on or before
  organizationId: z.string().optional(),
  isFeatured: zStringBoolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  orderBy: z.enum(["startDate", "createdAt", "title"]).default("startDate"),
  orderDir: z.enum(["asc", "desc"]).default("asc"),
});

export type EventSearchQuery = z.infer<typeof EventSearchQuerySchema>;

// ─── Registration Export ─────────────────────────────────────────────────────

export const RegistrationExportItemSchema = z.object({
  registrationId: z.string(),
  participantName: z.string().nullable(),
  participantEmail: z.string().nullable(),
  ticketType: z.string(),
  status: RegistrationStatusSchema,
  registeredAt: z.string().datetime(),
  checkedIn: z.boolean(),
  checkedInAt: z.string().datetime().nullable(),
});

export type RegistrationExportItem = z.infer<typeof RegistrationExportItemSchema>;

// ─── Ticket Type Management ──────────────────────────────────────────────────

export const CreateTicketTypeSchema = TicketTypeSchema.omit({
  id: true,
  soldCount: true,
});

export type CreateTicketTypeDto = z.infer<typeof CreateTicketTypeSchema>;

export const UpdateTicketTypeSchema = CreateTicketTypeSchema.partial();

export type UpdateTicketTypeDto = z.infer<typeof UpdateTicketTypeSchema>;

// ─── Event Clone ────────────────────────────────────────────────────────────

export const CloneEventSchema = z.object({
  newTitle: z.string().min(3).max(200).optional(),
  newStartDate: z.string().datetime(),
  newEndDate: z.string().datetime(),
  copyTicketTypes: z.boolean().default(true),
  copyAccessZones: z.boolean().default(true),
});

export type CloneEventDto = z.infer<typeof CloneEventSchema>;
