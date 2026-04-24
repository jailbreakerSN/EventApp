/**
 * T2.6 / T5.3 — pure grouping utility for the audit timeline view.
 *
 * Extracted from the admin/audit page component so we can unit-test it
 * without a full page render. The function groups audit rows by their
 * Dakar-local calendar day, using a stable ISO-date key and a
 * localized display string. See `audit/page.tsx` for the original
 * motivation (timezone-consistent grouping across every operator).
 */

export interface TimelineLog {
  id?: string;
  timestamp?: string;
  [k: string]: unknown;
}

export interface TimelineGroup {
  /** ISO-date key in Africa/Dakar time, e.g. "2026-04-24". Stable across locales. */
  isoKey: string;
  /** Localized French label, e.g. "24 avril 2026". */
  display: string;
  entries: TimelineLog[];
}

const DAKAR_TZ = "Africa/Dakar";

// fr-CA yields YYYY-MM-DD (ISO-aligned). Used as the stable key.
const isoKeyFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: DAKAR_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const displayFmt = new Intl.DateTimeFormat("fr-SN", {
  timeZone: DAKAR_TZ,
  year: "numeric",
  month: "long",
  day: "numeric",
});

/**
 * Group rows by Dakar-local day. Rows without a timestamp are dropped.
 * Returns a `Map.entries()`-style iterable preserving first-seen order
 * — the caller typically passes rows already sorted by timestamp desc.
 */
export function groupAuditRowsByDakarDay(
  rows: readonly TimelineLog[],
): Array<[string, { display: string; entries: TimelineLog[] }]> {
  const groups = new Map<string, { display: string; entries: TimelineLog[] }>();
  for (const log of rows) {
    const ts = log.timestamp ?? "";
    if (!ts) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const isoKey = isoKeyFmt.format(d);
    const display = displayFmt.format(d);
    const bucket = groups.get(isoKey);
    if (bucket) bucket.entries.push(log);
    else groups.set(isoKey, { display, entries: [log] });
  }
  return Array.from(groups.entries());
}
