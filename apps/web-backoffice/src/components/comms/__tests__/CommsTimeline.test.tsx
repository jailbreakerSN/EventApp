import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommsTimeline, buildTimelineGeometry } from "../CommsTimeline";
import type { CommsTimelineEntry } from "@/hooks/use-comms-timeline";

// ─── CommsTimeline — geometry + render contract ──────────────────────────
//
// Phase O5: gantt-style horizontal frieze. Pure path / position
// helpers are pinned independently of the JSX, then a small render
// suite covers the empty-state and the today-marker visibility.

const NOW = new Date("2026-04-26T12:00:00.000Z");

function buildEntry(partial: Partial<CommsTimelineEntry> & { id: string }): CommsTimelineEntry {
  return {
    sourceId: partial.sourceId ?? partial.id,
    kind: "broadcast",
    at: partial.at ?? "2026-04-26T10:00:00.000Z",
    channel: partial.channel ?? "email",
    status: partial.status ?? "scheduled",
    title: partial.title ?? "Title",
    preview: partial.preview ?? "Preview",
    recipientCount: partial.recipientCount ?? 0,
    sentCount: partial.sentCount ?? 0,
    failedCount: partial.failedCount ?? 0,
    ...partial,
  };
}

describe("buildTimelineGeometry — positioning", () => {
  it("returns an empty `positioned` list and a default 7-day window when no entries", () => {
    const out = buildTimelineGeometry({
      entries: [],
      rangeStart: null,
      rangeEnd: null,
      width: 720,
      now: NOW,
    });
    expect(out.positioned).toEqual([]);
    expect(out.windowEndMs - out.windowStartMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("places one entry per channel on the correct row", () => {
    const entries = [
      buildEntry({ id: "a", channel: "email" }),
      buildEntry({ id: "b", channel: "push", at: "2026-04-26T11:00:00.000Z" }),
    ];
    const out = buildTimelineGeometry({
      entries,
      rangeStart: "2026-04-26T10:00:00.000Z",
      rangeEnd: "2026-04-26T11:00:00.000Z",
      width: 720,
      now: NOW,
    });
    expect(out.positioned).toHaveLength(2);
    // The two rows differ — push is below email.
    expect(out.positioned[0].cy).toBeLessThan(out.positioned[1].cy);
  });

  it("expands a too-narrow window to the 7-day minimum so a single entry doesn't compress to a point", () => {
    const out = buildTimelineGeometry({
      entries: [buildEntry({ id: "single" })],
      rangeStart: "2026-04-26T10:00:00.000Z",
      rangeEnd: "2026-04-26T10:30:00.000Z", // 30 minutes only
      width: 720,
      now: NOW,
    });
    expect(out.windowEndMs - out.windowStartMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it("produces a today marker x-position when `now` falls inside the window", () => {
    const out = buildTimelineGeometry({
      entries: [buildEntry({ id: "a" })],
      rangeStart: "2026-04-20T00:00:00.000Z",
      rangeEnd: "2026-04-30T00:00:00.000Z",
      width: 720,
      now: NOW,
    });
    expect(out.todayX).not.toBeNull();
    expect(out.todayX!).toBeGreaterThan(0);
  });

  it("includes `now` in the window even when entries fall before it (historical view)", () => {
    const out = buildTimelineGeometry({
      entries: [buildEntry({ id: "old", at: "2026-03-01T10:00:00.000Z" })],
      rangeStart: "2026-03-01T10:00:00.000Z",
      rangeEnd: "2026-03-01T11:00:00.000Z",
      width: 720,
      now: NOW,
    });
    // Window must extend at least to NOW so the today-marker is on
    // the canvas.
    expect(out.windowEndMs).toBeGreaterThanOrEqual(NOW.getTime());
  });
});

describe("CommsTimeline — render", () => {
  it("renders the loading placeholder when data is undefined", () => {
    render(<CommsTimeline data={undefined} />);
    expect(screen.getByText("Chargement…")).toBeInTheDocument();
  });

  it("renders the empty state when `data.entries` is empty", () => {
    render(
      <CommsTimeline
        data={{ entries: [], rangeStart: null, rangeEnd: null, computedAt: NOW.toISOString() }}
      />,
    );
    expect(
      screen.getByText("Pas encore de communications planifiées pour cet événement."),
    ).toBeInTheDocument();
  });

  it("renders an SVG with one circle per entry plus the today marker text", () => {
    const { container } = render(
      <CommsTimeline
        data={{
          entries: [
            buildEntry({ id: "a", channel: "email", at: "2026-04-26T10:00:00.000Z" }),
            buildEntry({
              id: "b",
              channel: "push",
              at: "2026-04-27T10:00:00.000Z",
              status: "sent",
            }),
          ],
          rangeStart: "2026-04-26T10:00:00.000Z",
          rangeEnd: "2026-04-27T10:00:00.000Z",
          computedAt: NOW.toISOString(),
        }}
        now={NOW}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("circle")).toHaveLength(2);
    expect(container.textContent).toContain("Aujourd'hui");
  });
});
