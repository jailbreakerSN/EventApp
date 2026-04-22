import { z } from "zod";
import { SystemRoleSchema } from "./permissions.types";
import { OrgMemberRoleSchema } from "./organization.types";

// ─── Roles ────────────────────────────────────────────────────────────────────
// Re-export SystemRole as UserRole for backward compatibility.
// New code should use SystemRole and the permission system.

export const UserRoleSchema = SystemRoleSchema;
export type UserRole = z.infer<typeof UserRoleSchema>;

// ─── Profile ──────────────────────────────────────────────────────────────────

// ─── FCM Tokens (Web Push + Mobile) ──────────────────────────────────────────
// Each token is a registered push destination. We track the platform and user
// agent so we can prune stale web-push subscriptions (Phase C.1). The legacy
// shape was `string[]` — the API service (`fcm-tokens.service.ts`) transparently
// migrates either representation on first write.

export const FcmTokenPlatformSchema = z.enum(["web", "ios", "android"]);
export type FcmTokenPlatform = z.infer<typeof FcmTokenPlatformSchema>;

export const FcmTokenSchema = z.object({
  token: z.string().min(1),
  platform: FcmTokenPlatformSchema,
  userAgent: z.string().optional(), // browser UA at registration time (web only)
  registeredAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
});
export type FcmToken = z.infer<typeof FcmTokenSchema>;

// Backward-compat: legacy docs stored `fcmTokens: string[]`. The service layer
// upgrades the shape on the next write. Clients MUST never write this field
// directly — Firestore rules exclude it from the owner-writable field set;
// registration flows through POST /v1/me/fcm-tokens.
export const UserFcmTokensSchema = z
  .union([z.array(FcmTokenSchema), z.array(z.string())])
  .optional();

export const UserProfileSchema = z.object({
  uid: z.string(),
  email: z.string().email(),
  displayName: z.string().min(2).max(100),
  photoURL: z.string().url().nullable().optional(),
  phone: z.string().nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  roles: z.array(UserRoleSchema).min(1),
  organizationId: z.string().nullable().optional(), // for organizers / staff
  // Per-org role (owner / admin / member / viewer) mirrored from Auth
  // custom claims so Firestore rules + admin UIs that read the user doc
  // don't have to round-trip to Auth. Closes the Class B drift vector
  // identified in the security audit.
  orgRole: OrgMemberRoleSchema.nullable().optional(),
  preferredLanguage: z.enum(["fr", "en", "wo"]).default("fr"),
  // FCM device tokens for push notifications. Accepts both the legacy
  // `string[]` shape and the new `FcmToken[]` shape while the migration
  // rolls out; `fcm-tokens.service.ts` always writes the new shape.
  fcmTokens: UserFcmTokensSchema,
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

// ─── FCM Token Registration (Phase C.1 — Web Push) ───────────────────────────
// Body contract for POST /v1/me/fcm-tokens. The client never writes the user
// doc directly; registration/refresh/revocation flow through the API so we
// can dedupe, cap, and audit. Token length is capped at 4096 chars — FCM web
// tokens are ~160 chars, APNs ~180, but we leave headroom for provider drift.

export const RegisterFcmTokenRequestSchema = z.object({
  token: z.string().min(1).max(4096),
  platform: FcmTokenPlatformSchema,
  userAgent: z.string().max(512).optional(),
});

export type RegisterFcmTokenRequest = z.infer<typeof RegisterFcmTokenRequestSchema>;
