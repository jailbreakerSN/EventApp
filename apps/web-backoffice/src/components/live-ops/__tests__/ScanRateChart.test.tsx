import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ScanRateChart, buildScanRateGeometry, type ScanRateBucket } from "../ScanRateChart";

// ─── ScanRateChart — geometry + render contract ───────────────────────────
//
// Geometry is a pure function so we pin the math separately from the
// React render. The component tests only cover the empty-state
// fallback + structural assertions (path tags, total in aria label).

const flatSeries: ScanRateBucket[] = Array.from({ length: 30 }).map((_, i) => ({
  at: new Date(Date.UTC(2026, 3, 26, 10, i)).toISOString(),
  count: 0,
}));

const populatedSeries: ScanRateBucket[] = flatSeries.map((b, i) => ({
  ...b,
  // Shape: ramp 0→8 over 30 minutes, peak in the middle.
  count: i < 15 ? Math.floor(i / 2) : Math.max(0, 14 - i),
}));

describe("buildScanRateGeometry — pure path math", () => {
  it("returns empty paths when fewer than 2 buckets are provided", () => {
    const out = buildScanRateGeometry({ buckets: [], width: 360, height: 96 });
    expect(out.linePath).toBe("");
    expect(out.areaPath).toBe("");
    expect(out.totalCount).toBe(0);
    expect(out.lastPoint).toBeNull();
  });

  it("generates one M + (N-1) L commands for the line, plus a closed Z for the area", () => {
    const out = buildScanRateGeometry({
      buckets: populatedSeries,
      width: 360,
      height: 96,
    });
    // Line: M + 29 L
    expect((out.linePath.match(/[ML]/g) ?? []).length).toBe(30);
    // Area: starts with M (baseline), 30 Ls, then Z
    expect(out.areaPath.startsWith("M")).toBe(true);
    expect(out.areaPath.endsWith("Z")).toBe(true);
  });

  it("scales the Y axis to ceil(rawMax * 1.25) with a floor of 4", () => {
    const out = buildScanRateGeometry({
      buckets: populatedSeries,
      width: 360,
      height: 96,
    });
    // Raw max in populatedSeries is 7. ceil(7 * 1.25) = 9. Floor of 4
    // means the assertion is "max(4, 9)" = 9.
    expect(out.yMax).toBe(9);
  });

  it("enforces a minimum yMax of 4 even on tiny traffic", () => {
    const tiny: ScanRateBucket[] = flatSeries.slice(0, 30).map((b, i) => ({
      ...b,
      count: i === 0 ? 1 : 0,
    }));
    const out = buildScanRateGeometry({ buckets: tiny, width: 360, height: 96 });
    expect(out.yMax).toBe(4);
  });

  it("sums the bucket counts into totalCount", () => {
    const out = buildScanRateGeometry({
      buckets: populatedSeries,
      width: 360,
      height: 96,
    });
    const expectedTotal = populatedSeries.reduce((acc, b) => acc + b.count, 0);
    expect(out.totalCount).toBe(expectedTotal);
  });

  it("places the last point at the right edge of the inner area", () => {
    const out = buildScanRateGeometry({
      buckets: populatedSeries,
      width: 360,
      height: 96,
    });
    // PADDING.left + innerWidth = 28 + (360 - 28 - 12) = 28 + 320 = 348.
    expect(out.lastPoint!.x).toBeCloseTo(348, 0);
  });
});

describe("ScanRateChart — render contract", () => {
  it("renders the empty-state placeholder when every bucket is zero", () => {
    const { container } = render(<ScanRateChart buckets={flatSeries} />);
    expect(container.textContent).toContain("En attente du premier scan");
    // The empty state shows a Lucide Activity icon (its own <svg>). The
    // chart SVG itself is identifiable by `role="img"` — that one MUST
    // be absent in the empty state.
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });

  it("renders the SVG with line + area paths when traffic exists", () => {
    const { container } = render(<ScanRateChart buckets={populatedSeries} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("path").length).toBeGreaterThanOrEqual(2);
    expect(svg?.getAttribute("aria-label")).toContain("dernières minutes");
  });

  it("respects width / height props on the rendered SVG", () => {
    const { container } = render(
      <ScanRateChart buckets={populatedSeries} width={420} height={120} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("420");
    expect(svg?.getAttribute("height")).toBe("120");
  });
});
