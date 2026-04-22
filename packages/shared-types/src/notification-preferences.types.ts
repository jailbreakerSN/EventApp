import { z } from "zod";

// ─── Notification Preferences (per-channel, Phase 2.6) ─────────────────────
// Historically `NotificationPreferences.byKey: Record<string, boolean>`
// stored a single boolean per notification key (on / off for ALL channels).
// As SMS / push / in_app adapters come online, users need finer-grained
// control — e.g. "keep emails for event.reminder but drop the SMS".
//
// The upgrade is additive and backward-compatible:
//   - `byKey[key]` can still be a bare boolean (legacy docs keep working).
//   - `byKey[key]` can also be an object with per-channel overrides.
//   - Missing channels in the object default to enabled (true).
//
// Resolution logic lives in the pure helper
// `apps/api/src/services/notifications/channel-preferences.ts` so it can be
// unit-tested without Firestore. The dispatcher (Phase 3) will call the
// helper after loading the user's preferences.

/**
 * Per-channel override object. Missing channels default to `true` — an
 * absent entry is NOT an opt-out, only an explicit `false` is.
 */
export const NotificationChannelPreferenceSchema = z.object({
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  push: z.boolean().optional(),
  in_app: z.boolean().optional(),
});

export type NotificationChannelPreference = z.infer<
  typeof NotificationChannelPreferenceSchema
>;

/**
 * Per-key preference value. Either:
 *   - a bare boolean (legacy: applies to every channel), or
 *   - a per-channel object (Phase 2.6+).
 *
 * The union is discriminated at runtime by `typeof value === "boolean"`.
 */
export const NotificationPreferenceValueSchema = z.union([
  z.boolean(),
  NotificationChannelPreferenceSchema,
]);

export type NotificationPreferenceValue = z.infer<
  typeof NotificationPreferenceValueSchema
>;
