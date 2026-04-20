import type { Event } from "@teranga/shared-types";

// ─── Scan-policy lock key derivation ───────────────────────────────────────
// The `checkinLocks` collection enforces uniqueness per the event's
// `scanPolicy`. Each successful scan creates a lock at a well-known key;
// a subsequent scan that hashes to the same key sees the lock and is
// classified as a duplicate.
//
//   single     → key = `${registrationId}`
//                  (classic "one scan ever" — current default)
//   multi_zone → key = `${registrationId}:zone:${accessZoneId ?? "default"}`
//                  (participant can pass through access, lunch, afterparty
//                   zones once each)
//   multi_day  → key = `${registrationId}:day:${dayBucket}` where
//                  `dayBucket` is the YYYY-MM-DD date of `scannedAt` in
//                   the event's timezone. Enables 3-day festivals where a
//                   badge is scannable once per day.
//
// When `accessZoneId` is omitted (ticket has no zone restriction) the
// `multi_zone` key falls back to `default` — equivalent to `single` for
// that participant, which is the safest behavior.

export type ScanPolicy = NonNullable<Event["scanPolicy"]>;

/**
 * Compute the `YYYY-MM-DD` bucket for `scannedAt` in the given IANA
 * timezone. Defaults to `Africa/Dakar` (CLAUDE.md locale default) if
 * the event doesn't pin a timezone.
 */
export function computeDayBucket(scannedAtIso: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(scannedAtIso));
}

export function computeLockKey(args: {
  registrationId: string;
  policy: ScanPolicy;
  accessZoneId?: string | null;
  scannedAtIso: string;
  timezone: string;
}): string {
  const { registrationId, policy, accessZoneId, scannedAtIso, timezone } = args;
  switch (policy) {
    case "multi_zone":
      return `${registrationId}:zone:${accessZoneId ?? "default"}`;
    case "multi_day":
      return `${registrationId}:day:${computeDayBucket(scannedAtIso, timezone)}`;
    case "single":
    default:
      return registrationId;
  }
}

/**
 * The dayBucket string we persist on each `checkins` row alongside the
 * lock key, so the security dashboard can filter by day without parsing
 * `scannedAt` client-side.
 */
export function checkinDayBucket(scannedAtIso: string, timezone: string): string {
  return computeDayBucket(scannedAtIso, timezone);
}
