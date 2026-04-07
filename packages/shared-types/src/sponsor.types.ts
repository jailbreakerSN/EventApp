import { z } from "zod";

// ─── Sponsor Tier ───────────────────────────────────────────────────────────

export const SponsorTierSchema = z.enum([
  "platinum",
  "gold",
  "silver",
  "bronze",
  "partner",
]);

export type SponsorTier = z.infer<typeof SponsorTierSchema>;

// ─── Sponsor Profile ────────────────────────────────────────────────────────

export const SponsorProfileSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  eventId: z.string(),
  organizationId: z.string(),
  companyName: z.string().min(1).max(200),
  logoURL: z.string().url().nullable(),
  description: z.string().max(2000).nullable(),
  website: z.string().url().nullable(),
  tier: SponsorTierSchema,
  boothTitle: z.string().max(200).nullable(),
  boothDescription: z.string().max(2000).nullable(),
  boothBannerURL: z.string().url().nullable(),
  ctaLabel: z.string().max(100).nullable(),
  ctaUrl: z.string().url().nullable(),
  contactName: z.string().max(200).nullable(),
  contactEmail: z.string().email().nullable(),
  contactPhone: z.string().max(30).nullable(),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SponsorProfile = z.infer<typeof SponsorProfileSchema>;

export const CreateSponsorSchema = z.object({
  eventId: z.string(),
  companyName: z.string().min(1).max(200),
  tier: SponsorTierSchema,
  logoURL: z.string().url().optional(),
  description: z.string().max(2000).optional(),
  website: z.string().url().optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(30).optional(),
  userId: z.string().optional(),
});

export type CreateSponsorDto = z.infer<typeof CreateSponsorSchema>;

export const UpdateSponsorSchema = z.object({
  companyName: z.string().min(1).max(200).optional(),
  tier: SponsorTierSchema.optional(),
  logoURL: z.string().url().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  website: z.string().url().nullable().optional(),
  boothTitle: z.string().max(200).nullable().optional(),
  boothDescription: z.string().max(2000).nullable().optional(),
  boothBannerURL: z.string().url().nullable().optional(),
  ctaLabel: z.string().max(100).nullable().optional(),
  ctaUrl: z.string().url().nullable().optional(),
  contactName: z.string().max(200).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(30).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateSponsorDto = z.infer<typeof UpdateSponsorSchema>;

export const SponsorQuerySchema = z.object({
  tier: SponsorTierSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type SponsorQuery = z.infer<typeof SponsorQuerySchema>;

// ─── Sponsor Lead ───────────────────────────────────────────────────────────

export const SponsorLeadSchema = z.object({
  id: z.string(),
  sponsorId: z.string(),
  eventId: z.string(),
  participantId: z.string(),
  participantName: z.string(),
  participantEmail: z.string().nullable(),
  participantPhone: z.string().nullable(),
  notes: z.string().max(1000).nullable(),
  tags: z.array(z.string()).default([]),
  scannedAt: z.string().datetime(),
  scannedBy: z.string(),
});

export type SponsorLead = z.infer<typeof SponsorLeadSchema>;

export const CreateLeadSchema = z.object({
  qrCodeValue: z.string(),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
});

export type CreateLeadDto = z.infer<typeof CreateLeadSchema>;

export const LeadQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type LeadQuery = z.infer<typeof LeadQuerySchema>;
