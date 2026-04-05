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
