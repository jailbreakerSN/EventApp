import { describe, it, expect } from "vitest";
import { isLiveWindow, liveWindowState } from "../live-window";

// ─── live-window — pure helper contract ───────────────────────────────────
//
// J-0 ±6 h gating used by /overview and the live page banner. The
// helper is pure and doesn't read the system clock — the caller hands
// in `now`, which keeps tests deterministic without `vi.useFakeTimers`.

const START = "2026-04-26T10:00:00.000Z";
const END = "2026-04-26T18:00:00.000Z";

describe("isLiveWindow", () => {
  it("returns true for `now` inside [start − 6h, end + 6h]", () => {
    expect(isLiveWindow(START, END, new Date("2026-04-26T05:00:00.000Z"))).toBe(true); // -5h
    expect(isLiveWindow(START, END, new Date("2026-04-26T14:00:00.000Z"))).toBe(true); // mid
    expect(isLiveWindow(START, END, new Date("2026-04-26T22:00:00.000Z"))).toBe(true); // +4h
  });

  it("returns false before the pre-window starts (T-7h)", () => {
    expect(isLiveWindow(START, END, new Date("2026-04-26T03:00:00.000Z"))).toBe(false);
  });

  it("returns false after the post-window ends (T+7h)", () => {
    expect(isLiveWindow(START, END, new Date("2026-04-27T01:00:00.000Z"))).toBe(false);
  });

  it("falls back to a 12h assumed duration when endDate is null", () => {
    // start 2026-04-26 10h00 → assumed end 2026-04-26 22h00 → window
    // closes 2026-04-27 04h00.
    expect(isLiveWindow(START, null, new Date("2026-04-27T03:30:00.000Z"))).toBe(true);
    expect(isLiveWindow(START, null, new Date("2026-04-27T04:30:00.000Z"))).toBe(false);
  });

  it("returns false on unparseable dates rather than throwing", () => {
    expect(isLiveWindow("not-a-date", END, new Date("2026-04-26T14:00:00.000Z"))).toBe(false);
  });
});

describe("liveWindowState", () => {
  it("returns 'before' when `now` precedes the pre-window", () => {
    expect(liveWindowState(START, END, new Date("2026-04-26T03:00:00.000Z"))).toBe("before");
  });

  it("returns 'live' inside the J-0 ±6h band", () => {
    expect(liveWindowState(START, END, new Date("2026-04-26T05:00:00.000Z"))).toBe("live");
    expect(liveWindowState(START, END, new Date("2026-04-26T13:00:00.000Z"))).toBe("live");
    expect(liveWindowState(START, END, new Date("2026-04-26T22:00:00.000Z"))).toBe("live");
  });

  it("returns 'after' once the post-window closes", () => {
    expect(liveWindowState(START, END, new Date("2026-04-27T01:00:00.000Z"))).toBe("after");
  });

  it("returns 'before' when the start date is invalid", () => {
    expect(liveWindowState("nope", END, new Date())).toBe("before");
  });
});
