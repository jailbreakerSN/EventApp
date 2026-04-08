import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const EventStatusSchema = z.enum([
  "draft",
  "published",
  "cancelled",
  "completed",
  "archived",
]);

export type EventStatus = z.infer<typeof EventStatusSchema>;

export const EventFormatSchema = z.enum([
  "in_person",
  "online",
  "hybrid",
]);

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
  coordinates: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  googleMapsUrl: z.string().url().optional(),
  streamUrl: z.string().url().optional(), // for online/hybrid events
});

export type Location = z.infer<typeof LocationSchema>;

// ─── Access Zone ──────────────────────────────────────────────────────────────

export const AccessZoneSchema = z.object({
  id: z.string(),
  name: z.string(),                   // e.g. "VIP", "General", "Press"
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
  date: z.string().optional(),               // YYYY-MM-DD filter
  speakerId: z.string().optional(),
  location: z.string().optional(),           // room/stage filter
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type SessionScheduleQuery = z.infer<typeof SessionScheduleQuerySchema>;

// ─── Ticket Type ──────────────────────────────────────────────────────────────

export const TicketTypeSchema = z.object({
  id: z.string(),
  name: z.string(),                        // e.g. "VIP", "Standard", "Press"
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
  templateId: z.string().nullable().optional(), // created from a template
  createdBy: z.string(),  // Firebase UID
  updatedBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable().optional(),
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
});

export type CreateEventDto = z.infer<typeof CreateEventSchema>;

export const UpdateEventSchema = CreateEventSchema.partial().omit({
  organizationId: true,
});

export type UpdateEventDto = z.infer<typeof UpdateEventSchema>;

// ─── Registration ─────────────────────────────────────────────────────────────

export const RegistrationStatusSchema = z.enum([
  "pending",           // awaiting approval (requiresApproval = true)
  "pending_payment",   // awaiting payment for paid tickets
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
  eventTitle: z.string().optional(),       // denormalized for display
  ticketTypeName: z.string().optional(),   // denormalized for display
  status: RegistrationStatusSchema.default("confirmed"),
  qrCodeValue: z.string(),  // unique QR payload
  checkedInAt: z.string().datetime().nullable().optional(),
  checkedInBy: z.string().nullable().optional(), // staff uid
  accessZoneId: z.string().nullable().optional(), // zone scanned at
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Registration = z.infer<typeof RegistrationSchema>;

// ─── Event Search Query ──────────────────────────────────────────────────────

export const EventSearchQuerySchema = z.object({
  q: z.string().max(200).optional(),                 // title prefix search
  category: EventCategorySchema.optional(),
  format: EventFormatSchema.optional(),
  city: z.string().optional(),
  country: z.string().length(2).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(), // comma-separated or array
  dateFrom: z.string().datetime().optional(),         // events starting on or after
  dateTo: z.string().datetime().optional(),           // events starting on or before
  organizationId: z.string().optional(),
  isFeatured: z.coerce.boolean().optional(),
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
