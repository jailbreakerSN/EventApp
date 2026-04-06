import { z } from "zod";

export const OrganizationPlanSchema = z.enum([
  "free",       // up to 2 events/month, 100 participants
  "starter",    // up to 10 events/month, 500 participants
  "pro",        // unlimited events, 5000 participants
  "enterprise", // unlimited, white-label, custom branding
]);

export type OrganizationPlan = z.infer<typeof OrganizationPlanSchema>;

export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string().min(2).max(150),
  slug: z.string().regex(/^[a-z0-9-]+$/), // URL-friendly identifier
  logoURL: z.string().url().nullable().optional(),
  coverURL: z.string().url().nullable().optional(),
  website: z.string().url().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  country: z.string().length(2).default("SN"), // ISO 3166-1 alpha-2
  city: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  plan: OrganizationPlanSchema.default("free"),
  ownerId: z.string(), // Firebase UID of the owner/super-organizer
  memberIds: z.array(z.string()).default([]), // Firebase UIDs of members
  isVerified: z.boolean().default(false), // KYB verification
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Organization = z.infer<typeof OrganizationSchema>;

export const CreateOrganizationSchema = OrganizationSchema.omit({
  id: true,
  ownerId: true,
  memberIds: true,
  isVerified: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateOrganizationDto = z.infer<typeof CreateOrganizationSchema>;

export const UpdateOrganizationSchema = CreateOrganizationSchema.partial().omit({
  slug: true, // slug is immutable
});

export type UpdateOrganizationDto = z.infer<typeof UpdateOrganizationSchema>;

// ─── Organization Member Role ────────────────────────────────────────────────

export const OrgMemberRoleSchema = z.enum([
  "owner",        // full control, can delete org
  "admin",        // manage events, members, settings — cannot delete org
  "member",       // create/manage own events, view analytics
  "viewer",       // read-only access to org dashboard
]);

export type OrgMemberRole = z.infer<typeof OrgMemberRoleSchema>;

export const OrgMemberSchema = z.object({
  userId: z.string(),
  role: OrgMemberRoleSchema,
  displayName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  joinedAt: z.string().datetime(),
});

export type OrgMember = z.infer<typeof OrgMemberSchema>;

// ─── Organization Invite ────────────────────────────────────────────────────

export const InviteStatusSchema = z.enum(["pending", "accepted", "declined", "expired"]);
export type InviteStatus = z.infer<typeof InviteStatusSchema>;

export const OrganizationInviteSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  email: z.string().email(),
  role: OrgMemberRoleSchema,
  status: InviteStatusSchema.default("pending"),
  invitedBy: z.string(),
  invitedByName: z.string().nullable().optional(),
  token: z.string(), // unique invite token
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type OrganizationInvite = z.infer<typeof OrganizationInviteSchema>;

export const CreateInviteSchema = z.object({
  email: z.string().email(),
  role: OrgMemberRoleSchema.default("member"),
});

export type CreateInviteDto = z.infer<typeof CreateInviteSchema>;

// ─── Analytics ──────────────────────────────────────────────────────────────

export const AnalyticsTimeframeSchema = z.enum(["7d", "30d", "90d", "12m", "all"]);
export type AnalyticsTimeframe = z.infer<typeof AnalyticsTimeframeSchema>;

export const AnalyticsQuerySchema = z.object({
  timeframe: AnalyticsTimeframeSchema.default("30d"),
  eventId: z.string().optional(), // filter to a single event
});

export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

export const TimeSeriesPointSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  count: z.number().int(),
});

export type TimeSeriesPoint = z.infer<typeof TimeSeriesPointSchema>;

export const OrgAnalyticsSchema = z.object({
  organizationId: z.string(),
  timeframe: AnalyticsTimeframeSchema,
  summary: z.object({
    totalEvents: z.number().int(),
    totalRegistrations: z.number().int(),
    totalCheckedIn: z.number().int(),
    totalCancelled: z.number().int(),
    checkinRate: z.number(), // 0-1
  }),
  registrationsOverTime: z.array(TimeSeriesPointSchema),
  checkinsOverTime: z.array(TimeSeriesPointSchema),
  byCategory: z.array(z.object({
    category: z.string(),
    count: z.number().int(),
  })),
  byTicketType: z.array(z.object({
    ticketTypeName: z.string(),
    registered: z.number().int(),
    checkedIn: z.number().int(),
  })),
  topEvents: z.array(z.object({
    eventId: z.string(),
    title: z.string(),
    registeredCount: z.number().int(),
    checkedInCount: z.number().int(),
  })),
});

export type OrgAnalytics = z.infer<typeof OrgAnalyticsSchema>;

// ─── Event Clone ────────────────────────────────────────────────────────────

export const CloneEventSchema = z.object({
  newTitle: z.string().min(3).max(200).optional(),
  newStartDate: z.string().datetime(),
  newEndDate: z.string().datetime(),
  copyTicketTypes: z.boolean().default(true),
  copyAccessZones: z.boolean().default(true),
});

export type CloneEventDto = z.infer<typeof CloneEventSchema>;

// ─── Plan Limits (single source of truth) ────────────────────────────────────
// Used by API for enforcement and by frontends for plan feature display.
// Infinity means unlimited — frontends should check with isFinite().

export interface PlanLimits {
  maxEvents: number;
  maxParticipants: number;
  maxMembers: number;
}

export const PLAN_LIMITS: Record<OrganizationPlan, PlanLimits> = {
  free:       { maxEvents: 2,        maxParticipants: 100,   maxMembers: 3 },
  starter:    { maxEvents: 10,       maxParticipants: 500,   maxMembers: 10 },
  pro:        { maxEvents: Infinity, maxParticipants: 5000,  maxMembers: 50 },
  enterprise: { maxEvents: Infinity, maxParticipants: Infinity, maxMembers: Infinity },
};
