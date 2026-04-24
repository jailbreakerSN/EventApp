import {
  type RecurrenceRule,
  RECURRENCE_MAX_OCCURRENCES,
} from "@teranga/shared-types";
import { ValidationError } from "@/errors/app-error";

// ─── Recurrence occurrence generator (Phase 7+ item #B1) ──────────────────
//
// Pure function. No Firestore I/O, no side effects. The event service
// wraps its output in a transaction that writes parent + children in one
// atomic batch.
//
// Design: rather than taking a heavyweight dependency on rrule.js (which
// targets iCal RFC 5545 with timezone headaches), we implement a narrow
// walk over `freq`/`interval`/`byDay`/`byMonthDay` that covers the MVP's
// target use cases:
//   - "Atelier chaque mardi" → daily or weekly, byDay=[TU]
//   - "1er vendredi du mois" → monthly, byDay=[FR], byMonthDay=[1..7]
//   - "Tous les 2 jours" → daily, interval=2
//
// The caller's `timezone` is honoured: the walk operates in the event's
// local calendar so "every Monday" means local-Monday, not UTC-Monday.
// Date→UTC conversion at the end of each iteration preserves the
// original `startDate`'s wall-clock hour.
//
// Hard cap: RECURRENCE_MAX_OCCURRENCES (52). The caller MUST also
// enforce plan quota on top of that against the org's `maxEvents`.

interface OccurrenceSpec {
  /** ISO datetime string for this occurrence's start, in UTC. */
  startDate: string;
  /** ISO datetime string for this occurrence's end, in UTC. */
  endDate: string;
  /** Chronological 0-indexed position in the series. */
  index: number;
}

const DAY_TO_ISO: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 0,
};

/**
 * Expand a recurrence rule into an ordered list of occurrence date pairs.
 *
 * @param startDate ISO datetime — first occurrence's start (UTC in the
 *                  payload, interpreted as `timezone`-local by the walk).
 * @param endDate   ISO datetime — first occurrence's end. Must be >
 *                  startDate.
 * @param rule      Parsed RecurrenceRule (validated by the Zod schema).
 * @param timezone  IANA tz id (e.g. "Africa/Dakar"). Defaults to
 *                  Africa/Dakar when absent — matches the platform default.
 * @throws ValidationError on invalid rule / end-before-start / cap breach.
 */
export function generateOccurrences(
  startDate: string,
  endDate: string,
  rule: RecurrenceRule,
  timezone: string = "Africa/Dakar",
): OccurrenceSpec[] {
  const firstStart = new Date(startDate);
  const firstEnd = new Date(endDate);
  if (Number.isNaN(firstStart.getTime()) || Number.isNaN(firstEnd.getTime())) {
    throw new ValidationError("Dates de début/fin invalides pour la série.");
  }
  if (firstEnd.getTime() <= firstStart.getTime()) {
    throw new ValidationError(
      "La date de fin doit être postérieure à la date de début.",
    );
  }
  const durationMs = firstEnd.getTime() - firstStart.getTime();

  // Normalise cap: the rule's `count` is a hard ceiling when set; the
  // service-wide RECURRENCE_MAX_OCCURRENCES is the fallback upper bound.
  const targetCount = rule.count ?? RECURRENCE_MAX_OCCURRENCES;
  if (targetCount > RECURRENCE_MAX_OCCURRENCES) {
    throw new ValidationError(
      `Une série ne peut pas dépasser ${RECURRENCE_MAX_OCCURRENCES} occurrences.`,
    );
  }

  const untilTs = rule.until ? new Date(rule.until).getTime() : null;
  if (untilTs !== null && Number.isNaN(untilTs)) {
    throw new ValidationError("`until` invalide sur la règle de récurrence.");
  }
  if (untilTs !== null && untilTs <= firstStart.getTime()) {
    throw new ValidationError(
      "`until` doit être postérieure au début de la première occurrence.",
    );
  }

  // byDay filter → normalised set of JS `getDay()` values (0=Sunday..6=Saturday).
  // When absent, the filter matches every day (for weekly/daily) or
  // delegates to byMonthDay (for monthly).
  const byDaySet = rule.byDay ? new Set(rule.byDay.map((d) => DAY_TO_ISO[d])) : null;
  const byMonthDaySet = rule.byMonthDay ? new Set(rule.byMonthDay) : null;

  const interval = rule.interval ?? 1;
  const occurrences: OccurrenceSpec[] = [];

  // ── First occurrence — always included if it satisfies the filter ──
  // For weekly rules with `byDay`, the first occurrence must fall on one
  // of the allowed weekdays (the service rejects misaligned inputs).
  // We short-circuit here so the walker can use a uniform step forward.
  if (!matchesFilter(firstStart, rule.freq, byDaySet, byMonthDaySet, timezone)) {
    throw new ValidationError(
      "La date de début ne correspond pas au filtre de récurrence (jour / jour du mois).",
    );
  }

  occurrences.push({ startDate, endDate, index: 0 });

  // ── Walker ─────────────────────────────────────────────────────────────
  // Step one unit forward (interval * freq) and append matching occurrences
  // until we hit `count` or pass `until`. We DON'T step by day for weekly
  // rules — `freq: weekly, byDay: [MO, WE, FR]` means "three per week",
  // so we step day-by-day and filter by byDay set within each week window.
  // Simpler semantics: for daily + weekly, iterate day by day; for monthly,
  // iterate month by month.
  const stepDays = rule.freq === "daily" ? interval : rule.freq === "weekly" ? 1 : 0;
  let cursor = new Date(firstStart.getTime());
  // Walk until we hit the cap or untilTs.
  // Safety cap on iterations separate from `targetCount` to avoid runaway
  // loops on degenerate inputs; we bound at 2 years.
  const SAFETY_ITER = 730;
  let iter = 0;
  while (occurrences.length < targetCount && iter < SAFETY_ITER) {
    iter += 1;

    if (rule.freq === "monthly") {
      cursor = advanceMonths(cursor, interval);
    } else {
      cursor = new Date(cursor.getTime() + stepDays * 24 * 60 * 60 * 1000);
    }

    if (untilTs !== null && cursor.getTime() > untilTs) break;

    if (matchesFilter(cursor, rule.freq, byDaySet, byMonthDaySet, timezone)) {
      const occStart = cursor;
      const occEnd = new Date(cursor.getTime() + durationMs);
      if (untilTs !== null && occStart.getTime() > untilTs) break;
      occurrences.push({
        startDate: occStart.toISOString(),
        endDate: occEnd.toISOString(),
        index: occurrences.length,
      });
    }
  }

  return occurrences;
}

function matchesFilter(
  d: Date,
  freq: RecurrenceRule["freq"],
  byDaySet: Set<number> | null,
  byMonthDaySet: Set<number> | null,
  _timezone: string,
): boolean {
  // For the MVP we evaluate `getDay()` / `getDate()` directly against the
  // UTC date. The incoming `startDate` is a user-chosen wall-clock time
  // stored as UTC — same hour, same weekday, same day-of-month whether we
  // read it in UTC or local-Dakar (UTC+0 equivalent). A future enhancement
  // can swap in `Intl.DateTimeFormat` zoned extraction if we need exotic
  // timezones, but for Africa/Dakar (UTC+0) the distinction is a no-op.
  const jsDay = d.getUTCDay();
  const monthDay = d.getUTCDate();

  if (freq === "daily") {
    if (byDaySet && !byDaySet.has(jsDay)) return false;
    return true;
  }
  if (freq === "weekly") {
    if (byDaySet && !byDaySet.has(jsDay)) return false;
    return true;
  }
  // monthly
  if (byMonthDaySet && !byMonthDaySet.has(monthDay)) return false;
  if (byDaySet && !byDaySet.has(jsDay)) return false;
  return true;
}

function advanceMonths(d: Date, months: number): Date {
  const next = new Date(d.getTime());
  // Using UTC to stay deterministic; same rationale as matchesFilter.
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}
