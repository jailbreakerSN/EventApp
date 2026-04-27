import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dakarMonthBoundsISO, getDateRange } from "../date-utils";

/**
 * Regression suite for the participant /events date filter.
 *
 * Bug history: `this_month`, `this_week`, and `next_month` used to
 * return a `dateTo` set to the boundary day at 00:00:00 local time.
 * Events scheduled later that day (e.g. a 14:00 conference on the
 * last day of the month) were excluded because their `startDate` was
 * greater than `dateTo`. Visible to users as "Ce mois affiche zéro
 * résultat même quand des événements existent ce mois-ci".
 *
 * Every range MUST end at 23:59:59.999 of the inclusive last day.
 */

describe("getDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty when filter is undefined", () => {
    expect(getDateRange(undefined)).toEqual({});
  });

  it("returns empty for an unknown filter key", () => {
    expect(getDateRange("bogus")).toEqual({});
  });

  describe("today", () => {
    it("spans local midnight today → midnight tomorrow", () => {
      vi.setSystemTime(new Date(2026, 3, 15, 14, 30, 0)); // April 15 2026 14:30
      const r = getDateRange("today");
      // Strict ordering: dateFrom < dateTo, exactly one calendar day
      expect(new Date(r.dateFrom!).getTime()).toBeLessThan(new Date(r.dateTo!).getTime());
      const span = new Date(r.dateTo!).getTime() - new Date(r.dateFrom!).getTime();
      expect(span).toBe(86_400_000);
    });
  });

  describe("this_week", () => {
    it("dateTo lands at 23:59:59.999 of the last day, not 00:00", () => {
      vi.setSystemTime(new Date(2026, 3, 15, 14, 30, 0)); // Wed Apr 15
      const r = getDateRange("this_week");
      const end = new Date(r.dateTo!);
      // The bug: end.getHours() === 0 — events later that day excluded.
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getSeconds()).toBe(59);
    });
  });

  describe("this_weekend", () => {
    it("dateTo is Sunday 23:59:59.999 (already correct in v1)", () => {
      vi.setSystemTime(new Date(2026, 3, 15, 9, 0, 0)); // Wed Apr 15
      const r = getDateRange("this_weekend");
      const end = new Date(r.dateTo!);
      expect(end.getHours()).toBe(23);
      expect(end.getDay()).toBe(0); // Sunday
    });
  });

  describe("this_month", () => {
    it("dateTo is the last day of the current month at 23:59:59.999", () => {
      // April 27 2026 — month has 30 days
      vi.setSystemTime(new Date(2026, 3, 27, 9, 0, 0));
      const r = getDateRange("this_month");
      const end = new Date(r.dateTo!);
      expect(end.getMonth()).toBe(3); // April (0-indexed)
      expect(end.getDate()).toBe(30); // last day of April
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      // The bug: end was at 00:00 of the 30th, so a 14:00 event on
      // April 30 had startDate > dateTo and was filtered out.
    });

    it("includes a same-day-as-end-of-month event in the range", () => {
      vi.setSystemTime(new Date(2026, 3, 27, 9, 0, 0));
      const r = getDateRange("this_month");
      // Simulated event: April 30 2026 at 14:00 local
      const eventAt = new Date(2026, 3, 30, 14, 0, 0).toISOString();
      expect(eventAt > r.dateFrom!).toBe(true);
      // Critical regression assertion — pre-fix this was `false`
      expect(eventAt < r.dateTo!).toBe(true);
    });

    it("handles month boundaries (February → March)", () => {
      vi.setSystemTime(new Date(2026, 1, 15, 9, 0, 0)); // Feb 15 2026
      const r = getDateRange("this_month");
      const end = new Date(r.dateTo!);
      expect(end.getMonth()).toBe(1); // February
      expect(end.getDate()).toBe(28); // 2026 is not leap
    });
  });

  describe("next_month", () => {
    it("dateTo is the last day of next month at 23:59:59.999", () => {
      vi.setSystemTime(new Date(2026, 3, 27, 9, 0, 0));
      const r = getDateRange("next_month");
      const start = new Date(r.dateFrom!);
      const end = new Date(r.dateTo!);
      expect(start.getMonth()).toBe(4); // May
      expect(start.getDate()).toBe(1);
      expect(end.getMonth()).toBe(4); // still May
      expect(end.getDate()).toBe(31); // last day of May
      expect(end.getHours()).toBe(23);
    });
  });
});

/**
 * Regression suite for `dakarMonthBoundsISO()` — used by the
 * /my-events calendar-discovery overlay to fetch the events visible
 * in the active month.
 *
 * Bug history (sibling to PR #215 calendar fix): the original
 * formula was `new Date(year, month, 1).toISOString()` which builds
 * LOCAL midnight on day 1 and re-projects to UTC. For any user east
 * of Dakar (Paris UTC+2 in DST) that shifts the bound BACKWARD into
 * the previous month — the discovery overlay would query
 * `[March 31 22:00 UTC, April 30 21:59 UTC]` instead of the intended
 * `[April 1, April 30]` Dakar window.
 *
 * The fix anchors at UTC noon-style explicit components — Africa/Dakar
 * is UTC+0 so UTC bounds map exactly to Dakar bounds with no offset
 * math. These assertions are tz-independent (no `vi.useFakeTimers`)
 * because they only inspect the canonical ISO output.
 */
describe("dakarMonthBoundsISO", () => {
  it("returns April 1 → April 30 23:59:59.999 UTC for (2026, 3)", () => {
    const { dateFrom, dateTo } = dakarMonthBoundsISO(2026, 3);
    expect(dateFrom).toBe("2026-04-01T00:00:00.000Z");
    expect(dateTo).toBe("2026-04-30T23:59:59.999Z");
  });

  it("handles December → January wraparound for (2026, 11)", () => {
    const { dateFrom, dateTo } = dakarMonthBoundsISO(2026, 11);
    expect(dateFrom).toBe("2026-12-01T00:00:00.000Z");
    expect(dateTo).toBe("2026-12-31T23:59:59.999Z");
  });

  it("handles February in a non-leap year (2026 = non-leap)", () => {
    const { dateFrom, dateTo } = dakarMonthBoundsISO(2026, 1);
    expect(dateFrom).toBe("2026-02-01T00:00:00.000Z");
    expect(dateTo).toBe("2026-02-28T23:59:59.999Z");
  });

  it("handles February in a leap year (2024)", () => {
    const { dateFrom, dateTo } = dakarMonthBoundsISO(2024, 1);
    expect(dateFrom).toBe("2024-02-01T00:00:00.000Z");
    expect(dateTo).toBe("2024-02-29T23:59:59.999Z");
  });

  it("never depends on the host timezone (ISO output is UTC)", () => {
    // Both bounds end with `Z` and are deterministic — independent of
    // whatever TZ the test runner / CI machine is in.
    const { dateFrom, dateTo } = dakarMonthBoundsISO(2026, 6); // July
    expect(dateFrom).toMatch(/Z$/);
    expect(dateTo).toMatch(/Z$/);
    expect(dateFrom).toBe("2026-07-01T00:00:00.000Z");
    expect(dateTo).toBe("2026-07-31T23:59:59.999Z");
  });

  // Critical regression assertion — pre-fix the LOCAL anchor would
  // shift this to "2026-03-31T22:00:00.000Z" for a Paris client.
  it("dateFrom for April is exactly April 1 00:00:00 UTC", () => {
    const { dateFrom } = dakarMonthBoundsISO(2026, 3);
    const parsed = new Date(dateFrom);
    expect(parsed.getUTCMonth()).toBe(3);
    expect(parsed.getUTCDate()).toBe(1);
    expect(parsed.getUTCHours()).toBe(0);
  });
});
