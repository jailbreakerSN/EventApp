import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HealthGauge } from "../HealthGauge";

// ─── HealthGauge — pure render contract ──────────────────────────────────
//
// A presentational component that translates `score` + `tier` into an
// SVG circular gauge. Tests pin the labels, the score clamping, and
// the accessibility contract (`role="img"` + aria-label) — anything
// downstream relies on these for screen-reader access.

describe("HealthGauge — score rendering", () => {
  it("renders the rounded score in the centre", () => {
    const { container } = render(<HealthGauge score={73} tier="healthy" />);
    expect(container.textContent).toContain("73");
    expect(container.textContent).toContain("Bonne santé");
  });

  it("clamps a score above 100 to 100", () => {
    const { container } = render(<HealthGauge score={123} tier="excellent" />);
    expect(container.textContent).toContain("100");
  });

  it("clamps a negative score to 0", () => {
    const { container } = render(<HealthGauge score={-5} tier="critical" />);
    expect(container.textContent).toContain("0");
  });

  it("rounds non-integer scores", () => {
    const { container } = render(<HealthGauge score={62.4} tier="healthy" />);
    expect(container.textContent).toContain("62");
    expect(container.textContent).not.toContain("62.4");
  });
});

describe("HealthGauge — tier label + accessibility", () => {
  it.each([
    ["excellent", "Excellent"],
    ["healthy", "Bonne santé"],
    ["at_risk", "Attention"],
    ["critical", "Critique"],
  ] as const)("renders the FR label for tier %s", (tier, label) => {
    const { container } = render(<HealthGauge score={50} tier={tier} />);
    expect(container.textContent).toContain(label);
  });

  it("exposes the gauge as role=img with an FR aria-label", () => {
    const { container } = render(<HealthGauge score={42} tier="at_risk" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toContain("42");
    expect(svg?.getAttribute("aria-label")?.toLowerCase()).toContain("attention");
  });

  it("hides the centre tier label when hideLabel=true (used in compact embeds)", () => {
    const { container } = render(<HealthGauge score={73} tier="healthy" hideLabel />);
    // The sub-text that lives below the SVG is removed; the in-SVG
    // <text> "Bonne santé" was never there to begin with — only the
    // span outside.
    expect(container.querySelector("span.text-xs")).toBeNull();
  });

  it("respects the `size` prop on the rendered SVG", () => {
    const { container } = render(<HealthGauge score={50} tier="healthy" size={64} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("64");
    expect(svg?.getAttribute("height")).toBe("64");
  });
});
