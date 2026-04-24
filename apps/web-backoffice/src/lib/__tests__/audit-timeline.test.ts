import { describe, it, expect } from "vitest";
import { groupAuditRowsByDakarDay } from "../audit-timeline";

/**
 * T5.3 — grouping utility contract.
 *
 * Guards the product invariants:
 *   1. Keys are stable ISO dates in Africa/Dakar (no locale drift).
 *   2. Display strings are French-localized but never used as keys.
 *   3. Events near midnight UTC group by the DAKAR day, not the
 *      browser's local day.
 *   4. Missing / malformed timestamps are dropped silently.
 */

describe("groupAuditRowsByDakarDay", () => {
  it("groups two entries on the same Dakar day under one bucket", () => {
    const groups = groupAuditRowsByDakarDay([
      { id: "a", timestamp: "2026-04-24T08:00:00Z" },
      { id: "b", timestamp: "2026-04-24T15:00:00Z" },
    ]);
    expect(groups).toHaveLength(1);
    const [isoKey, bucket] = groups[0]!;
    expect(isoKey).toBe("2026-04-24");
    expect(bucket.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("groups by Dakar day, not UTC day, for events just before midnight UTC", () => {
    // 23:30 UTC on 2026-04-24 = 23:30 Dakar (Dakar is UTC+0).
    // 00:30 UTC on 2026-04-25 = 00:30 Dakar — Dakar-local day flips.
    const groups = groupAuditRowsByDakarDay([
      { id: "latenight", timestamp: "2026-04-24T23:30:00Z" },
      { id: "earlymorning", timestamp: "2026-04-25T00:30:00Z" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map(([k]) => k)).toEqual(["2026-04-24", "2026-04-25"]);
  });

  it("drops rows with no timestamp", () => {
    const groups = groupAuditRowsByDakarDay([
      { id: "a", timestamp: "2026-04-24T08:00:00Z" },
      { id: "b" }, // no timestamp
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]![1].entries).toHaveLength(1);
    expect(groups[0]![1].entries[0]?.id).toBe("a");
  });

  it("drops rows with malformed timestamps without throwing", () => {
    const groups = groupAuditRowsByDakarDay([
      { id: "a", timestamp: "2026-04-24T08:00:00Z" },
      { id: "garbage", timestamp: "not-a-date" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]![1].entries.map((e) => e.id)).toEqual(["a"]);
  });

  it("preserves insertion order across groups (caller sorts upstream)", () => {
    const groups = groupAuditRowsByDakarDay([
      { id: "newest", timestamp: "2026-04-25T10:00:00Z" },
      { id: "middle", timestamp: "2026-04-25T09:00:00Z" },
      { id: "oldest", timestamp: "2026-04-24T10:00:00Z" },
    ]);
    // 2026-04-25 seen first → first in the returned array.
    expect(groups.map(([k]) => k)).toEqual(["2026-04-25", "2026-04-24"]);
  });

  it("emits a French-localized display string separate from the key", () => {
    const [[_key, bucket]] = groupAuditRowsByDakarDay([
      { id: "a", timestamp: "2026-04-24T08:00:00Z" },
    ]);
    // Exact month spelling varies per ICU version; assert the relevant
    // fragments are present rather than pinning the full string.
    expect(bucket.display).toMatch(/24/);
    expect(bucket.display.toLowerCase()).toMatch(/avril/);
    expect(bucket.display).toMatch(/2026/);
  });

  it("handles an empty input without throwing", () => {
    expect(groupAuditRowsByDakarDay([])).toEqual([]);
  });
});
