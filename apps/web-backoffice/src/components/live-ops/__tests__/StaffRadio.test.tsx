import { describe, it, expect } from "vitest";
import { formatTime } from "../helpers";

// ─── formatTime — HH:mm helper ───────────────────────────────────────────
//
// Pure helper — the chat panel's relative-time grouping uses this
// to render the per-message header. We assert local-clock formatting
// (the display matches the operator's timezone, by design).

describe("formatTime", () => {
  it("formats valid ISO timestamps as zero-padded HH:mm", () => {
    const d = new Date("2026-04-26T08:09:00");
    // Re-derive expected from the same Date so the test stays
    // robust across CI timezones (the helper uses local hours).
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    expect(formatTime(d.toISOString())).toBe(`${hh}:${mm}`);
  });

  it("returns an em-dash on invalid input rather than throwing", () => {
    expect(formatTime("not-a-date")).toBe("—");
    expect(formatTime("")).toBe("—");
  });
});
