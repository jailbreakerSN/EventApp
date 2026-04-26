/**
 * Organizer overhaul — Phase O8.
 *
 * Pure helpers extracted from the live-ops React components so they
 * can be unit-tested without booting Firebase. The components keep
 * their own re-exports for ergonomics — callers never need to import
 * from this file directly.
 */

/** Format "X minutes ago" — used by IncidentLog rows. */
export function formatElapsed(createdAtIso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(createdAtIso).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "à l'instant";
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  return `il y a ${diffD} j`;
}

/** Format an ISO timestamp as HH:mm in the local clock — used by StaffRadio. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
