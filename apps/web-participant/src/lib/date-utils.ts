/**
 * Dakar-anchored ISO bounds for a (year, month) pair. Anchored at UTC
 * because Africa/Dakar is UTC+0, so UTC bounds map exactly to Dakar
 * bounds with no offset math.
 *
 * Used by the calendar-discovery overlay on /my-events to fetch the
 * events visible in a given month. `new Date(year, month, 1).toISOString()`
 * was used originally — that's LOCAL midnight on day 1 re-projected to
 * UTC, which for any user east of Dakar (Paris UTC+2 in DST) shifts
 * the bound BACKWARD into the previous month. The discovery overlay
 * would query `[March 31 22:00 UTC, April 30 21:59 UTC]` instead of
 * `[April 1 00:00 UTC, April 30 23:59 UTC]` — events on the boundary
 * days were silently filtered out.
 */
export function dakarMonthBoundsISO(
  year: number,
  monthZeroIndexed: number,
): { dateFrom: string; dateTo: string } {
  const dateFrom = new Date(Date.UTC(year, monthZeroIndexed, 1, 0, 0, 0, 0)).toISOString();
  // `Date.UTC(year, month + 1, 0, ...)` returns the last day of `month`
  // (the 0-th day of the next month rolls back).
  const dateTo = new Date(
    Date.UTC(year, monthZeroIndexed + 1, 0, 23, 59, 59, 999),
  ).toISOString();
  return { dateFrom, dateTo };
}

/**
 * Compute dateFrom/dateTo ISO strings from a date filter shortcut.
 * This is a plain utility (no "use client") so it can be used in both
 * server components and client components.
 */
export function getDateRange(dateFilter: string | undefined): { dateFrom?: string; dateTo?: string } {
  if (!dateFilter) return {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (dateFilter) {
    case "today":
      return {
        dateFrom: today.toISOString(),
        dateTo: new Date(today.getTime() + 86400000).toISOString(),
      };
    case "this_week": {
      // Last day of the week up to 23:59:59.999. Without setHours,
      // dateTo is the end-of-week day at 00:00, which excludes events
      // scheduled later that same day — same root-cause bug as
      // this_month / next_month had before the fix.
      const endOfWeek = new Date(today);
      endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
      endOfWeek.setHours(23, 59, 59, 999);
      return { dateFrom: today.toISOString(), dateTo: endOfWeek.toISOString() };
    }
    case "this_weekend": {
      // Next Saturday 00:00 → Sunday 23:59:59. If today is Sat/Sun, include today.
      const day = today.getDay(); // 0 = Sunday, 6 = Saturday
      const daysUntilSaturday = day === 6 ? 0 : day === 0 ? -1 : 6 - day;
      const saturday = new Date(today);
      saturday.setDate(today.getDate() + daysUntilSaturday);
      const endOfSunday = new Date(saturday);
      endOfSunday.setDate(saturday.getDate() + (daysUntilSaturday === -1 ? 0 : 1));
      endOfSunday.setHours(23, 59, 59, 999);
      return { dateFrom: saturday.toISOString(), dateTo: endOfSunday.toISOString() };
    }
    case "this_month": {
      // `new Date(year, month + 1, 0)` returns the last day of the
      // current month at LOCAL MIDNIGHT — events scheduled later that
      // day are excluded from the range query (startDate > dateTo).
      // Force end-of-day so a 14:00 event on the 30th is included when
      // today is the 27th.
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);
      return { dateFrom: today.toISOString(), dateTo: endOfMonth.toISOString() };
    }
    case "next_month": {
      const startNext = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const endNext = new Date(today.getFullYear(), today.getMonth() + 2, 0);
      endNext.setHours(23, 59, 59, 999);
      return { dateFrom: startNext.toISOString(), dateTo: endNext.toISOString() };
    }
    default:
      return {};
  }
}
