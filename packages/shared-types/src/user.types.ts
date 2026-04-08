import { z } from "zod";
import { SystemRoleSchema } from "./permissions.types";

// ─── Roles ────────────────────────────────────────────────────────────────────
// Re-export SystemRole as UserRole for backward compatibility.
// New code should use SystemRole and the permission system.

export const UserRoleSchema = SystemRoleSchema;
export type UserRole = z.infer<typeof UserRoleSchema>;

// ─── Profile ──────────────────────────────────────────────────────────────────

export const UserProfileSchema = z.object({
  uid: z.string(),
  email: z.string().email(),
  displayName: z.string().min(2).max(100),
  photoURL: z.string().url().nullable().optional(),
  phone: z.string().nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  roles: z.array(UserRoleSchema).min(1),
  organizationId: z.string().nullable().optional(), // for organizers / staff
  preferredLanguage: z.enum(["fr", "en", "wo"]).default("fr"),
  fcmTokens: z.array(z.string()).optional(), // FCM device tokens for push notifications
  isEmailVerified: z.boolean().default(false),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// ─── Create / Update DTOs ─────────────────────────────────────────────────────

export const CreateUserProfileSchema = UserProfileSchema.omit({
  uid: true,
  createdAt: true,
  updatedAt: true,
  isEmailVerified: true,
  fcmTokens: true,
});

export type CreateUserProfileDto = z.infer<typeof CreateUserProfileSchema>;

export const UpdateUserProfileSchema = UserProfileSchema.pick({
  displayName: true,
  photoURL: true,
  phone: true,
  bio: true,
  preferredLanguage: true,
}).partial();

export type UpdateUserProfileDto = z.infer<typeof UpdateUserProfileSchema>;

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(2).max(100),
  phone: z.string().optional(),
  preferredLanguage: z.enum(["fr", "en", "wo"]).default("fr"),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email("Adresse email invalide"),
  password: z.string().min(1, "Ce champ est requis"),
});

export type LoginDto = z.infer<typeof LoginSchema>;
