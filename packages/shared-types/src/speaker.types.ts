import { z } from "zod";

// ─── Speaker Profile ────────────────────────────────────────────────────────

export const SpeakerProfileSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(), // nullable if speaker has no platform account
  eventId: z.string(),
  organizationId: z.string(),
  name: z.string().min(1).max(200),
  title: z.string().max(200).nullable(), // e.g. "CTO at TechCorp"
  company: z.string().max(200).nullable(),
  bio: z.string().max(2000).nullable(),
  photoURL: z.string().url().nullable(),
  slidesUrl: z.string().url().nullable().optional(),
  socialLinks: z
    .object({
      twitter: z.string().nullable(),
      linkedin: z.string().nullable(),
      website: z.string().nullable(),
    })
    .nullable(),
  topics: z.array(z.string()).default([]),
  sessionIds: z.array(z.string()).default([]),
  isConfirmed: z.boolean().default(false),
  createdBy: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SpeakerProfile = z.infer<typeof SpeakerProfileSchema>;

export const CreateSpeakerSchema = z.object({
  eventId: z.string(),
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  bio: z.string().max(2000).optional(),
  photoURL: z.string().url().optional(),
  slidesUrl: z.string().url().optional(),
  socialLinks: z
    .object({
      twitter: z.string().nullable().optional(),
      linkedin: z.string().nullable().optional(),
      website: z.string().nullable().optional(),
    })
    .optional(),
  topics: z.array(z.string()).optional(),
  sessionIds: z.array(z.string()).optional(),
  userId: z.string().optional(),
});

export type CreateSpeakerDto = z.infer<typeof CreateSpeakerSchema>;

export const UpdateSpeakerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  title: z.string().max(200).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  photoURL: z.string().url().nullable().optional(),
  slidesUrl: z.string().url().nullable().optional(),
  socialLinks: z
    .object({
      twitter: z.string().nullable().optional(),
      linkedin: z.string().nullable().optional(),
      website: z.string().nullable().optional(),
    })
    .optional(),
  topics: z.array(z.string()).optional(),
  sessionIds: z.array(z.string()).optional(),
  isConfirmed: z.boolean().optional(),
});

export type UpdateSpeakerDto = z.infer<typeof UpdateSpeakerSchema>;

export const SpeakerQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type SpeakerQuery = z.infer<typeof SpeakerQuerySchema>;
