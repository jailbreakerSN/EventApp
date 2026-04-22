import {
  type NotificationChannel,
  type NotificationPreferenceValue,
} from "@teranga/shared-types";

// ─── Channel preference resolver (Phase 2.6) ───────────────────────────────
// Pure helper — no Firestore, no logging. The dispatcher (Phase 3) loads the
// caller's notification-preferences doc once and feeds the `byKey` map in
// here for each `(key, channel)` pair it is about to touch.
//
// Resolution table (for a given (key, channel)):
//
//   | preferences.byKey[key]                | isChannelAllowedForUser |
//   | ------------------------------------- | ----------------------- |
//   | undefined (no entry)                  | true                    |
//   | true                                  | true                    |
//   | false                                 | false (legacy: all off) |
//   | { email: false, sms: true }           | per-channel lookup      |
//   |   lookup missing → default true       |                         |
//
// Rationale:
//   - Absent entry never implies opt-out: the preferences doc is populated
//     lazily, and a user who has never touched the settings page must still
//     receive their notifications.
//   - Legacy bare-boolean values keep working — docs written before
//     Phase 2.6 stay readable.
//   - The per-channel object is a partial map: channels not in the object
//     default to true so adding a new channel (e.g. in_app in Phase 6)
//     doesn't accidentally silence existing opt-ins.
//
// Phase 3 integration pointer:
//   `notification-dispatcher.service.ts` currently checks
//   `isUserOptedOut(recipient, definition, preferences)` which only
//   reads `byKey[key] === false`. When per-channel rollout lands, replace
//   that call with `isChannelAllowedForUser(preferences, definition.key,
//   channel)` inside the per-channel loop. No catalog change required.
//
// This helper is intentionally NOT wired into the dispatcher yet — Phase 2.2
// owns dispatcher edits and is in-flight in a parallel branch.

export interface NotificationPreferencesLike {
  byKey?: Record<string, NotificationPreferenceValue>;
}

/**
 * Resolve whether a given channel for a given notification key is allowed
 * for a user given their stored preferences. Pure function: the dispatcher
 * passes the already-loaded preferences, this decides the outcome.
 *
 *   - absent entry           → true (no opt-out)
 *   - byKey[key] === false   → false (legacy opt-out all channels)
 *   - byKey[key] === true    → true
 *   - byKey[key] object      → entry[channel] ?? true
 */
export function isChannelAllowedForUser(
  preferences: NotificationPreferencesLike | null | undefined,
  key: string,
  channel: NotificationChannel,
): boolean {
  const entry = preferences?.byKey?.[key];

  // Absent entry = no opt-out stored.
  if (entry === undefined) return true;

  // Legacy bare boolean — same value for every channel.
  if (typeof entry === "boolean") return entry;

  // Per-channel object — unspecified channels default to allowed.
  const perChannel = entry[channel];
  return perChannel ?? true;
}
