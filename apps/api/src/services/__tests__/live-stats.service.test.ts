import { describe, it, expect } from "vitest";
import { bucketScanRate, countDistinctAuthors, computeNoShowEstimate } from "../live-stats.service";

// ─── Live stats — pure helpers ───────────────────────────────────────────
//
// Phase O8. The service-level integration uses Firestore which we
// cover in the route tests. Here we pin the bucketing maths +
// no-show heuristic + distinct-author counting.

describe("bucketScanRate — minute bucketing", () => {
  it("returns N=windowMinutes buckets, all zeros, when no timestamps land in the window", () => {
    const now = new Date("2026-04-26T12:00:00.000Z");
    const out = bucketScanRate([], now, 30);
    expect(out).toHaveLength(30);
    expect(out.every((b) => b.count === 0)).toBe(true);
  });

  it("counts each timestamp into the right minute bucket", () => {
    const now = new Date("2026-04-26T12:00:00.000Z");
    const ts = [
      "2026-04-26T11:50:30.000Z", // 10 min ago
      "2026-04-26T11:50:40.000Z", // same bucket
      "2026-04-26T11:55:10.000Z", // 5 min ago
    ];
    const out = bucketScanRate(ts, now, 30);
    // Bucket index for `11:50` = window start (11:31) + 19 min = idx 19
    // Bucket index for `11:55` = idx 24
    const total = out.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(3);
    // Pin one bucket explicitly to catch off-by-one drift.
    const elevenFifty = out.find((b) => b.at.startsWith("2026-04-26T11:50"));
    expect(elevenFifty?.count).toBe(2);
  });

  it("ignores timestamps outside the window (older than windowMinutes)", () => {
    const now = new Date("2026-04-26T12:00:00.000Z");
    const out = bucketScanRate(["2026-04-26T10:00:00.000Z"], now, 30);
    expect(out.reduce((sum, b) => sum + b.count, 0)).toBe(0);
  });

  it("ignores null + invalid timestamps gracefully", () => {
    const now = new Date("2026-04-26T12:00:00.000Z");
    const out = bucketScanRate([null, "not-a-date", "2026-04-26T11:55:00.000Z"], now, 30);
    expect(out.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });

  it("emits ISO timestamps that align to minute boundaries (seconds = 0)", () => {
    const now = new Date("2026-04-26T12:00:42.500Z");
    const out = bucketScanRate([], now, 5);
    for (const b of out) {
      // Each bucket `at` must be a whole minute (`...:00.000Z`).
      expect(b.at.endsWith(":00.000Z")).toBe(true);
    }
  });
});

describe("countDistinctAuthors", () => {
  it("returns the count of distinct non-null author ids", () => {
    expect(countDistinctAuthors(["a", "b", "a", "c", null, "b"])).toBe(3);
  });

  it("returns 0 when every entry is null", () => {
    expect(countDistinctAuthors([null, null])).toBe(0);
  });

  it("returns 0 on empty input", () => {
    expect(countDistinctAuthors([])).toBe(0);
  });
});

describe("computeNoShowEstimate", () => {
  it("returns 0 before the event ends (we don't penalise late arrivals)", () => {
    const now = new Date("2026-05-01T10:00:00.000Z");
    expect(computeNoShowEstimate({ endDate: "2026-05-01T18:00:00.000Z" }, 100, 60, now)).toBe(0);
  });

  it("returns registered − checkedIn after the event has ended", () => {
    const now = new Date("2026-05-01T20:00:00.000Z");
    expect(computeNoShowEstimate({ endDate: "2026-05-01T18:00:00.000Z" }, 100, 60, now)).toBe(40);
  });

  it("clamps at 0 when checked-in count exceeds registered (defensive)", () => {
    const now = new Date("2026-05-01T20:00:00.000Z");
    expect(computeNoShowEstimate({ endDate: "2026-05-01T18:00:00.000Z" }, 50, 60, now)).toBe(0);
  });

  it("returns 0 when the event has no endDate", () => {
    const now = new Date("2026-05-01T20:00:00.000Z");
    expect(computeNoShowEstimate({ endDate: null }, 100, 60, now)).toBe(0);
  });
});
