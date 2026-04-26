/**
 * Organizer overhaul — Phase O8.
 *
 * Pure helpers for the J-0 ±6 h "live window" used by the live event
 * mode. Exported standalone so the entry point on /overview, the page
 * itself, and the unit tests can share the exact same logic.
 *
 *   isLiveWindow(start, end?, now)     → true when `now` is within
 *                                          [start − 6h, end + 6h] (or
 *                                          [start − 6h, start + 18h]
 *                                          when no end is provided —
 *                                          18 h covers a full day).
 *   liveWindowState(start, end?, now)  → "before" | "live" | "after"
 *                                          for the entry point's
 *                                          enabled / label decisions.
 */

const ONE_HOUR_MS = 60 * 60 * 1000;
const PRE_WINDOW_HOURS = 6;
const POST_WINDOW_HOURS = 6;
const FALLBACK_DURATION_HOURS = 12; // assumed event length when endDate is null

export function isLiveWindow(
  startIso: string,
  endIso: string | null | undefined,
  now: Date,
): boolean {
  const startMs = new Date(startIso).getTime();
  if (Number.isNaN(startMs)) return false;
  const endMs = endIso
    ? new Date(endIso).getTime()
    : startMs + FALLBACK_DURATION_HOURS * ONE_HOUR_MS;
  if (Number.isNaN(endMs)) return false;

  const windowStart = startMs - PRE_WINDOW_HOURS * ONE_HOUR_MS;
  const windowEnd = endMs + POST_WINDOW_HOURS * ONE_HOUR_MS;
  const t = now.getTime();
  return t >= windowStart && t <= windowEnd;
}

export type LiveWindowState = "before" | "live" | "after";

export function liveWindowState(
  startIso: string,
  endIso: string | null | undefined,
  now: Date,
): LiveWindowState {
  const startMs = new Date(startIso).getTime();
  if (Number.isNaN(startMs)) return "before";
  const endMs = endIso
    ? new Date(endIso).getTime()
    : startMs + FALLBACK_DURATION_HOURS * ONE_HOUR_MS;
  const windowStart = startMs - PRE_WINDOW_HOURS * ONE_HOUR_MS;
  const windowEnd = endMs + POST_WINDOW_HOURS * ONE_HOUR_MS;
  const t = now.getTime();
  if (t < windowStart) return "before";
  if (t > windowEnd) return "after";
  return "live";
}
