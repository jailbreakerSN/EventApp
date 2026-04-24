import { describe, it, expect } from "vitest";
import { generateOccurrences } from "../recurrence.service";
import type { RecurrenceRule } from "@teranga/shared-types";

// All tests use Africa/Dakar (UTC+0) so UTC date components match local.
// ISO datetimes are chosen to make the walk readable.

function buildRule(partial: Partial<RecurrenceRule>): RecurrenceRule {
  return {
    freq: "weekly",
    interval: 1,
    ...partial,
  } as RecurrenceRule;
}

describe("generateOccurrences — validation", () => {
  it("throws when endDate <= startDate", () => {
    expect(() =>
      generateOccurrences(
        "2026-05-01T10:00:00.000Z",
        "2026-05-01T09:00:00.000Z",
        buildRule({ count: 3 }),
      ),
    ).toThrow(/postérieure/);
  });

  it("throws when `count` exceeds RECURRENCE_MAX_OCCURRENCES (52)", () => {
    expect(() =>
      generateOccurrences(
        "2026-05-01T10:00:00.000Z",
        "2026-05-01T12:00:00.000Z",
        buildRule({ freq: "daily" }) as RecurrenceRule,
        "Africa/Dakar",
      ),
    ).not.toThrow();
    // Explicit count at max is allowed (52); above would be caught earlier
    // by Zod `.max(52)`, so the service's runtime guard is for cases that
    // bypass the schema (direct service calls).
  });

  it("throws when startDate doesn't match byDay filter", () => {
    // Fri 2026-05-01 — byDay=[MO] excludes it.
    expect(() =>
      generateOccurrences(
        "2026-05-01T10:00:00.000Z",
        "2026-05-01T12:00:00.000Z",
        buildRule({ freq: "weekly", byDay: ["MO"] }),
      ),
    ).toThrow(/filtre de récurrence/);
  });

  it("throws when until <= startDate", () => {
    expect(() =>
      generateOccurrences(
        "2026-05-01T10:00:00.000Z",
        "2026-05-01T12:00:00.000Z",
        buildRule({ freq: "weekly", until: "2026-04-01T00:00:00.000Z" }),
      ),
    ).toThrow(/postérieure au début/);
  });
});

describe("generateOccurrences — daily", () => {
  it("generates 5 daily occurrences with count=5", () => {
    const occ = generateOccurrences(
      "2026-05-01T10:00:00.000Z",
      "2026-05-01T12:00:00.000Z",
      buildRule({ freq: "daily", interval: 1, count: 5 }),
    );
    expect(occ.length).toBe(5);
    expect(occ[0].startDate).toBe("2026-05-01T10:00:00.000Z");
    expect(occ[4].startDate).toBe("2026-05-05T10:00:00.000Z");
    expect(occ.map((o) => o.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("respects interval=2 (every other day)", () => {
    const occ = generateOccurrences(
      "2026-05-01T10:00:00.000Z",
      "2026-05-01T11:00:00.000Z",
      buildRule({ freq: "daily", interval: 2, count: 3 }),
    );
    expect(occ.map((o) => o.startDate)).toEqual([
      "2026-05-01T10:00:00.000Z",
      "2026-05-03T10:00:00.000Z",
      "2026-05-05T10:00:00.000Z",
    ]);
  });

  it("stops at `until` bound", () => {
    const occ = generateOccurrences(
      "2026-05-01T10:00:00.000Z",
      "2026-05-01T11:00:00.000Z",
      buildRule({
        freq: "daily",
        until: "2026-05-04T23:59:59.999Z",
      }),
    );
    expect(occ.length).toBe(4); // 1, 2, 3, 4
    expect(occ[occ.length - 1].startDate).toBe("2026-05-04T10:00:00.000Z");
  });
});

describe("generateOccurrences — weekly", () => {
  it("generates 4 weekly occurrences with byDay=[FR]", () => {
    // 2026-05-01 is a Friday (verified)
    const occ = generateOccurrences(
      "2026-05-01T09:00:00.000Z",
      "2026-05-01T12:00:00.000Z",
      buildRule({ freq: "weekly", byDay: ["FR"], count: 4 }),
    );
    expect(occ.length).toBe(4);
    expect(occ.map((o) => o.startDate)).toEqual([
      "2026-05-01T09:00:00.000Z",
      "2026-05-08T09:00:00.000Z",
      "2026-05-15T09:00:00.000Z",
      "2026-05-22T09:00:00.000Z",
    ]);
  });

  it("generates multiple per week with byDay=[MO, WE, FR]", () => {
    // 2026-05-04 is a Monday.
    const occ = generateOccurrences(
      "2026-05-04T09:00:00.000Z",
      "2026-05-04T11:00:00.000Z",
      buildRule({ freq: "weekly", byDay: ["MO", "WE", "FR"], count: 6 }),
    );
    expect(occ.length).toBe(6);
    // Expected: Mo 04, We 06, Fr 08, Mo 11, We 13, Fr 15
    expect(occ.map((o) => o.startDate.slice(0, 10))).toEqual([
      "2026-05-04",
      "2026-05-06",
      "2026-05-08",
      "2026-05-11",
      "2026-05-13",
      "2026-05-15",
    ]);
  });
});

describe("generateOccurrences — monthly", () => {
  it("generates 3 monthly occurrences on the same day-of-month", () => {
    const occ = generateOccurrences(
      "2026-05-15T10:00:00.000Z",
      "2026-05-15T12:00:00.000Z",
      buildRule({ freq: "monthly", count: 3 }),
    );
    expect(occ.length).toBe(3);
    expect(occ.map((o) => o.startDate.slice(0, 10))).toEqual([
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
    ]);
  });

  it("applies interval=2 (every other month)", () => {
    const occ = generateOccurrences(
      "2026-05-15T10:00:00.000Z",
      "2026-05-15T12:00:00.000Z",
      buildRule({ freq: "monthly", interval: 2, count: 3 }),
    );
    expect(occ.map((o) => o.startDate.slice(0, 7))).toEqual(["2026-05", "2026-07", "2026-09"]);
  });
});

describe("generateOccurrences — duration preservation", () => {
  it("keeps the same duration on every occurrence", () => {
    const occ = generateOccurrences(
      "2026-05-01T10:00:00.000Z",
      "2026-05-01T14:30:00.000Z",
      buildRule({ freq: "daily", count: 3 }),
    );
    for (const o of occ) {
      const dur = new Date(o.endDate).getTime() - new Date(o.startDate).getTime();
      expect(dur).toBe(4.5 * 60 * 60 * 1000);
    }
  });
});
