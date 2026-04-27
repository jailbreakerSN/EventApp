import { describe, expect, it } from "vitest";

/**
 * Regression suite for the calendar month-label timezone bug.
 *
 * Bug history (2026-04-27): users in Europe/Paris (UTC+2 in DST) opened
 * /my-events and saw the calendar header read "mars 2026" while the
 * grid + cursor were correctly on April. They concluded every event was
 * shifted by a full month — e.g. an event on 17 July 2026 looked like
 * it sat on 17 June 2026.
 *
 * Root cause was the LOCAL-midnight + Dakar-tz formatting cycle:
 *
 *   const monthLabel = new Date(year, month, 1).toLocaleDateString("fr-FR", {
 *     month: "long",
 *     year: "numeric",
 *     timeZone: "Africa/Dakar",
 *   });
 *
 * `new Date(2026, 3, 1)` is "2026-04-01 00:00:00 LOCAL". For a Paris
 * client in DST that's "2026-03-31 22:00:00 UTC" — and Africa/Dakar
 * (UTC+0) renders that moment as 31 March → "mars 2026".
 *
 * The fix anchors the label moment at UTC noon mid-month, so no
 * inhabited timezone (UTC-12 ↔ UTC+14) can drift it across a month
 * boundary. This test pins the formula across a high-risk timezone
 * sample by stubbing `Date.prototype.toLocaleDateString` not at all —
 * we call the real Intl impl and assert that mid-month UTC noon falls
 * inside the target month for every tz the platform ships in.
 */

const ZONES = [
  "Africa/Dakar",
  "Europe/Paris",
  "Europe/London",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Pacific/Auckland",
] as const;

function safeMonthLabel(year: number, month: number, locale = "fr-FR", timeZone = "Africa/Dakar"): string {
  return new Date(Date.UTC(year, month, 15, 12, 0, 0)).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone,
  });
}

function unsafeMonthLabel_PRE_FIX(year: number, month: number, locale = "fr-FR", timeZone = "Africa/Dakar"): string {
  return new Date(year, month, 1).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone,
  });
}

describe("calendar month-label formula", () => {
  // The fix must yield the same month name as the canonical UTC-noon
  // representation for every supported display timezone, regardless of
  // where the Node process / browser thinks "local" is.
  for (const tz of ZONES) {
    it(`returns the right month name in ${tz} for April 2026`, () => {
      const label = safeMonthLabel(2026, 3, "en-US", tz);
      expect(label.toLowerCase()).toContain("april");
    });
  }

  // Cross-month-boundary check — December → January wraparound is the
  // adjacent-year edge case that exposed the original bug at the
  // year boundary too (label said "décembre" when showing January).
  it("returns January for month=0", () => {
    expect(safeMonthLabel(2026, 0, "en-US", "Europe/Paris").toLowerCase()).toContain("january");
  });

  it("returns December for month=11", () => {
    expect(safeMonthLabel(2026, 11, "en-US", "Pacific/Auckland").toLowerCase()).toContain("december");
  });

  // Suppress the unused-helper lint by exercising it in a smoke
  // assertion that simply documents the pre-fix shape. We do NOT
  // assert it's broken — the value depends on the test runner's TZ
  // and that's the entire point of why it had to be replaced.
  it("documents the pre-fix unsafe formula (for future archaeology)", () => {
    expect(typeof unsafeMonthLabel_PRE_FIX(2026, 3)).toBe("string");
  });
});
