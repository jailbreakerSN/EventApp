/**
 * Organizer overhaul — Phase O7.
 *
 * Org-scoped participant profile carrying free-form `tags` and an
 * organizer `notes` field that the participant never sees. Distinct
 * from the user document (which is the participant's identity) — the
 * profile is the **organisation's view of the participant**.
 *
 * Storage: `participantProfiles/{organizationId}_{userId}` (deterministic
 * doc id so a get-by-key is O(1) without a query). One doc per
 * (org, participant) pair — a participant inscribed at two
 * organisations carries two profiles, never aliased.
 *
 * Authorization model:
 *   - Read / write: `participant:read_all` (organizer + super_admin).
 *     Co-organizer scope is intentional — co-organizers see profile
 *     data for the events they co-manage in a future iteration.
 *   - The participant themselves NEVER reads their own org-scoped
 *     profile (the notes field would be a privacy leak).
 *
 * Why a separate doc rather than fields on the user doc:
 *   - `users/{uid}` is global (one identity across orgs). Co-locating
 *     org-specific tags would either force a `Record<orgId, …>` map
 *     (heavy + Firestore-rule-unfriendly) or leak across orgs.
 *   - Audit-friendliness: every profile mutation produces a row whose
 *     resourceId is the deterministic doc id, easy to filter on.
 */

import { z } from "zod";

export const ParticipantProfileSchema = z.object({
  /** Deterministic doc id `${organizationId}_${userId}`. */
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  /** Free-form labels assigned by the organizer (e.g. "VIP", "Press"). */
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  /**
   * Private organizer-only note. NOT visible to the participant.
   * Capped at 2000 chars — anything longer belongs in a CRM.
   */
  notes: z.string().max(2000).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ParticipantProfile = z.infer<typeof ParticipantProfileSchema>;

export const UpdateParticipantProfileSchema = z.object({
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type UpdateParticipantProfileDto = z.infer<typeof UpdateParticipantProfileSchema>;

// ─── Bulk action DTOs (Phase O7) ──────────────────────────────────────────
//
// The bulk actions on the registrations table all accept a list of
// registrationIds + the eventId they belong to. We share one DTO
// shape because the action verb is the difference, not the input.

export const BulkRegistrationActionSchema = z.object({
  registrationIds: z.array(z.string().min(1)).min(1).max(500),
});

export type BulkRegistrationActionDto = z.infer<typeof BulkRegistrationActionSchema>;

export const BulkTagRegistrationsSchema = BulkRegistrationActionSchema.extend({
  /** Tags to ADD to every selected participant's profile. */
  addTags: z.array(z.string().min(1).max(40)).max(10).default([]),
  /** Tags to REMOVE from every selected participant's profile. */
  removeTags: z.array(z.string().min(1).max(40)).max(10).default([]),
});

export type BulkTagRegistrationsDto = z.infer<typeof BulkTagRegistrationsSchema>;

// ─── Duplicate detection (Phase O7) ────────────────────────────────────────
//
// Pairs of participants in the same organisation whose normalised
// email or phone match. The detection service returns these
// candidates; the operator confirms the merge in the UI.

export const DuplicateCandidateSchema = z.object({
  /** Stable id for the pair — sorted concatenation of the two user ids. */
  pairId: z.string(),
  primaryUserId: z.string(),
  secondaryUserId: z.string(),
  /** Why the system flagged the pair (`email` or `phone`). */
  matchKind: z.enum(["email", "phone"]),
  /** Normalised value the two share. */
  matchValue: z.string(),
});

export type DuplicateCandidate = z.infer<typeof DuplicateCandidateSchema>;

export const MergeParticipantsSchema = z.object({
  /** Profile that survives. The other is folded into this one. */
  primaryUserId: z.string(),
  /** Profile that gets archived after the merge. */
  secondaryUserId: z.string(),
});

export type MergeParticipantsDto = z.infer<typeof MergeParticipantsSchema>;

// ─── Pure helpers (exported for tests + service reuse) ─────────────────────

/**
 * Normalise an email for duplicate detection: trim, lowercase, drop
 * the gmail-style `+suffix` aliasing (`alice+sponsor@gmail.com` →
 * `alice@gmail.com`). Other domains keep the suffix because gmail's
 * convention is non-universal.
 */
export function normaliseEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  const cleanLocal = isGmail ? local.split("+")[0].replace(/\./g, "") : local;
  return `${cleanLocal}@${domain}`;
}

/**
 * Normalise a phone for duplicate detection: strip every non-digit
 * character. Caller is expected to feed E.164-ish strings; full
 * libphonenumber parsing is overkill for a duplicate gate.
 */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D+/g, "");
}

/**
 * Build a deterministic pair id from two user ids — sorted
 * lexicographically so `(a, b)` and `(b, a)` produce the same key.
 */
export function buildDuplicatePairId(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}
