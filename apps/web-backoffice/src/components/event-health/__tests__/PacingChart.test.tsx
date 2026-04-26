import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PacingChart, buildPacingPaths, type PacingPoint } from "../PacingChart";

// ─── PacingChart — pure path geometry + render fallback ──────────────────
//
// Most of the chart is a pure path-builder, so the geometry is pinned
// here separately from the React render. The render tests only cover
// the empty-state fallback + the high-level structure (legend, axis
// labels) — pixel-perfect SVG output is fragile and not the contract
// downstream depends on.

const sample: PacingPoint[] = [
  { date: "2026-04-01", dayIndex: 0, actual: 0, expected: 0 },
  { date: "2026-04-08", dayIndex: 7, actual: 5, expected: 8 },
  { date: "2026-04-15", dayIndex: 14, actual: 14, expected: 20 },
];

describe("buildPacingPaths — geometry contract", () => {
  it("returns empty paths when fewer than 2 points are provided", () => {
    const out = buildPacingPaths({ pacing: [], width: 480, height: 200 });
    expect(out.actual).toBe("");
    expect(out.expected).toBe("");
    expect(out.max).toBe(0);
  });

  it("emits an SVG path for each series with matching point counts", () => {
    const out = buildPacingPaths({ pacing: sample, width: 480, height: 200 });
    // 3 points → "M ... L ... L ..." (1 M + 2 L) per series.
    expect(out.actual.match(/[ML]/g)?.length).toBe(3);
    expect(out.expected.match(/[ML]/g)?.length).toBe(3);
  });

  it("scales the Y axis to the max of (actual, expected) plus a 10 % headroom", () => {
    const out = buildPacingPaths({ pacing: sample, width: 480, height: 200 });
    // Max raw value across both series is 20 (expected at day 14).
    // Headroom = ceil(20 * 1.1) = 22.
    expect(out.max).toBe(22);
  });

  it("places the first M command at the left padding", () => {
    const out = buildPacingPaths({ pacing: sample, width: 480, height: 200 });
    // The path starts with "M<x>,<y>" — x should equal PADDING.left
    // (36) within rounding tolerance.
    const match = out.actual.match(/^M([\d.]+),/);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1])).toBeCloseTo(36, 0);
  });
});

describe("PacingChart — render contract", () => {
  it("renders an empty-state placeholder when fewer than 2 points are provided", () => {
    const { container } = render(<PacingChart pacing={[sample[0]]} />);
    expect(container.textContent).toContain("Pas encore assez de données");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders an SVG with two paths + the FR legend when ≥ 2 points exist", () => {
    const { container } = render(<PacingChart pacing={sample} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.querySelectorAll("path")).toHaveLength(2);
    expect(container.textContent).toContain("Réel");
    expect(container.textContent).toContain("Attendu");
  });

  it("renders 3 X-axis labels formatted as FR short dates", () => {
    const { container } = render(<PacingChart pacing={sample} />);
    // "2026-04-01" → "1 avr" (single-digit day, no zero-pad)
    expect(container.textContent).toContain("avr");
  });

  it("respects the width / height props on the rendered SVG", () => {
    const { container } = render(<PacingChart pacing={sample} width={600} height={300} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("600");
    expect(svg?.getAttribute("height")).toBe("300");
  });
});
