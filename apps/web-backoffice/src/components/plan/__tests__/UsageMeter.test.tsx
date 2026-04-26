import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { UsageMeter } from "../UsageMeter";

// ─── UsageMeter component coverage ───────────────────────────────────────────
// The leaf component that renders "X/Y" + a progress bar in the billing
// page header AND in the sidebar plan widget. Critical because:
//
//   1. It used to call the GLOBAL `isFinite()` on `limit`, which silently
//      coerces `null → 0` and returns `true` (the trap). On Pro plans the
//      API returns `Infinity`, JSON.stringify converts it to `null`, and
//      the meter painted "39/" + a red 100% bar with "Limite atteinte"
//      copy. Two production screenshots demonstrated the bug.
//   2. It's the rendering boundary for any unlimited-plan UI. The
//      contract we pin: any non-finite, null, undefined, zero or
//      negative `limit` = unlimited (∞ + zero progress).
//
// Assertion strategy: read `container.textContent` instead of
// `getByText("3")`. The meter splits "3/10" into three text nodes
// inside one span — `getByText` matches whole elements only, and the
// span's normalized textContent is "3/10", so a per-node "3" lookup
// would fail. Working off textContent is robust to whitespace + child
// node count.

const NEAR_LIMIT_REGEX = /\d+% utilisé/;
const AT_LIMIT_COPY = "Limite atteinte";
const BAR_SELECTOR = "[class*='rounded-full transition-all']";

describe("UsageMeter — unlimited plan rendering (Limite atteinte regression pin)", () => {
  it.each([
    ["limit: null (Infinity → null over JSON)", null],
    ["limit: undefined (missing field)", undefined],
    ["limit: Infinity (defensive client cache)", Infinity],
    ["limit: -1 (PLAN_LIMIT_UNLIMITED sentinel)", -1],
    ["limit: 0 (custom 0-cap plan)", 0],
  ])("renders ∞ and never the limite-atteinte banner when %s", (_label, limit) => {
    const { container } = render(<UsageMeter label="Événements" current={39} limit={limit} />);
    const text = container.textContent ?? "";

    // The counter renders "39/∞" — both pieces present, no orphan slash.
    expect(text).toContain("39/∞");
    expect(text).not.toContain(AT_LIMIT_COPY);
    expect(text).not.toMatch(NEAR_LIMIT_REGEX);

    // The progress bar's inline width is exactly 0% (unlimited plans
    // never paint a meaningful percent on top of ∞).
    const bar = container.querySelector(BAR_SELECTOR);
    expect(bar?.getAttribute("style")).toContain("width: 0%");
  });

  it("compact variant also handles null limit without the bug", () => {
    const { container } = render(
      <UsageMeter label="Événements" current={39} limit={null} compact />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("39/∞");
    expect(text).not.toContain(AT_LIMIT_COPY);
  });
});

describe("UsageMeter — finite-limit rendering", () => {
  it("renders the literal limit when finite", () => {
    const { container } = render(<UsageMeter label="Événements" current={3} limit={10} />);
    expect(container.textContent).toContain("3/10");
    expect(container.textContent).not.toContain("∞");
  });

  it("hides the warning copy under 80% usage", () => {
    const { container } = render(<UsageMeter label="Événements" current={5} limit={10} />); // 50%
    expect(container.textContent).not.toMatch(NEAR_LIMIT_REGEX);
    expect(container.textContent).not.toContain(AT_LIMIT_COPY);
  });

  it("shows the `X% utilisé` copy at >= 80% but under 100%", () => {
    const { container } = render(<UsageMeter label="Événements" current={8} limit={10} />); // 80%
    expect(container.textContent).toContain("80% utilisé");
    expect(container.textContent).not.toContain(AT_LIMIT_COPY);
  });

  it("shows `Limite atteinte` only at >= 100%", () => {
    const { container } = render(<UsageMeter label="Événements" current={10} limit={10} />);
    expect(container.textContent).toContain(AT_LIMIT_COPY);
  });

  it("clamps over-cap usage to 100% (post-downgrade legacy state)", () => {
    // 10 of 3 is the post-downgrade scenario from the hook spec — meter
    // bar must not overflow the container, label stays "Limite atteinte".
    const { container } = render(<UsageMeter label="Événements" current={10} limit={3} />);
    expect(container.textContent).toContain(AT_LIMIT_COPY);
    expect(container.textContent).not.toContain("333% utilisé");
    const bar = container.querySelector(BAR_SELECTOR);
    expect(bar?.getAttribute("style")).toContain("width: 100%");
  });

  it("floors negative current to 0 (defensive)", () => {
    const { container } = render(<UsageMeter label="Événements" current={-5} limit={10} />);
    // No warning, no over-cap label, no NaN%.
    expect(container.textContent).not.toMatch(NEAR_LIMIT_REGEX);
    expect(container.textContent).not.toContain(AT_LIMIT_COPY);
    expect(container.textContent).not.toContain("NaN");
  });
});
