import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanGate } from "../PlanGate";

// ─── PlanGate component coverage ───────────────────────────────────────────
// The component-level paywall gate. Given a PlanFeature, it either:
//   1. Renders children verbatim if the org has the feature enabled
//   2. Shows a blur + upgrade CTA (`fallback="blur"`, default)
//   3. Renders nothing (`fallback="hidden"`)
//   4. Shows a disabled / locked overlay (`fallback="disabled"`)
//
// Invariants we pin:
//   - When access is granted, children render with ZERO extra DOM
//     (no overlay, no blur wrapper) — important because any wrapper
//     would affect layout / a11y.
//   - When access is denied under "hidden", the children are NOT in
//     the DOM at all (paywall bypass via dev-tools inspection is
//     mitigated since the node isn't rendered).
//   - Under "blur", the children ARE in the DOM but wrapped with
//     `aria-hidden` + the upgrade CTA is focusable.
//
// Service + hook deps mocked at the boundary.

const mockCanUse = vi.fn();
const mockPlan = vi.fn(() => "free");

vi.mock("@/hooks/use-plan-gating", () => ({
  usePlanGating: () => ({ canUse: mockCanUse, plan: mockPlan() }),
}));

vi.mock("@/hooks/use-plans-catalog", () => ({
  usePlansCatalogMap: () => ({
    map: new Map([
      [
        "pro",
        {
          id: "pro",
          sortOrder: 2,
          name: { fr: "Pro", en: "Pro" },
          features: { advancedAnalytics: true, qrScanning: true },
        },
      ],
      [
        "starter",
        {
          id: "starter",
          sortOrder: 1,
          name: { fr: "Starter", en: "Starter" },
          features: { qrScanning: true },
        },
      ],
    ]),
  }),
  getPlanDisplay: (plan: string) => ({ name: { fr: plan === "free" ? "Gratuit" : plan } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCanUse.mockReset();
  mockPlan.mockReturnValue("free");
});

describe("PlanGate — access granted", () => {
  it("renders children verbatim when canUse returns true", () => {
    mockCanUse.mockReturnValue(true);

    render(
      <PlanGate feature="advancedAnalytics">
        <div data-testid="gated-content">inside the gate</div>
      </PlanGate>,
    );

    expect(screen.getByTestId("gated-content")).toHaveTextContent("inside the gate");
    // No upgrade CTA should be present on the happy path.
    expect(screen.queryByText(/Passer au plan/)).not.toBeInTheDocument();
  });

  it("calls canUse with the provided feature name", () => {
    mockCanUse.mockReturnValue(true);
    render(
      <PlanGate feature="paidTickets">
        <span>child</span>
      </PlanGate>,
    );
    expect(mockCanUse).toHaveBeenCalledWith("paidTickets");
  });
});

describe("PlanGate — access denied, fallback variants", () => {
  beforeEach(() => {
    mockCanUse.mockReturnValue(false);
  });

  it("fallback=blur wraps children with aria-hidden + renders upgrade CTA", () => {
    render(
      <PlanGate feature="advancedAnalytics" fallback="blur">
        <div data-testid="gated-content">premium data</div>
      </PlanGate>,
    );

    // Children stay in the DOM (they're blurred, not removed) but marked
    // aria-hidden so screen readers don't announce them.
    const child = screen.getByTestId("gated-content");
    expect(child).toBeInTheDocument();
    // Walk up to find the aria-hidden wrapper that contains the blurred child.
    let current: HTMLElement | null = child;
    let foundAriaHidden = false;
    while (current) {
      if (current.getAttribute("aria-hidden") === "true") {
        foundAriaHidden = true;
        break;
      }
      current = current.parentElement;
    }
    expect(foundAriaHidden).toBe(true);

    // Upgrade CTA is present + focusable (it's a Link).
    const cta = screen.getByRole("link", { name: /passer au plan/i });
    expect(cta).toHaveAttribute("href", "/organization/billing");
  });

  it("fallback=hidden renders nothing (paywall bypass mitigation)", () => {
    render(
      <PlanGate feature="advancedAnalytics" fallback="hidden">
        <div data-testid="gated-content">premium data</div>
      </PlanGate>,
    );
    // The node must NOT be in the DOM — a user browsing via dev-tools
    // should never see the premium payload.
    expect(screen.queryByTestId("gated-content")).not.toBeInTheDocument();
  });

  it("fallback=disabled renders children with reduced opacity + lock badge", () => {
    render(
      <PlanGate feature="advancedAnalytics" fallback="disabled">
        <button data-testid="gated-btn">Enable feature</button>
      </PlanGate>,
    );
    // Children are visible (so the UX shows what they'd get) but the
    // wrapper is aria-disabled and pointer-events-none so interactions
    // don't land. Re-assert the invariant via the aria-disabled attr.
    expect(screen.getByTestId("gated-btn")).toBeInTheDocument();
    const container = screen.getByTestId("gated-btn").parentElement;
    expect(container).toHaveAttribute("aria-disabled", "true");
  });

  it("defaults to blur when fallback is not specified", () => {
    render(
      <PlanGate feature="advancedAnalytics">
        <div>child</div>
      </PlanGate>,
    );
    // Upgrade CTA visible = blur fallback active.
    expect(screen.getByRole("link", { name: /passer au plan/i })).toBeInTheDocument();
  });

  it("surfaces the required plan name from the catalog", () => {
    // advancedAnalytics is enabled on "Pro" in the mocked catalog.
    render(
      <PlanGate feature="advancedAnalytics" fallback="blur">
        <div>child</div>
      </PlanGate>,
    );
    expect(screen.getByText(/Disponible avec le plan Pro/)).toBeInTheDocument();
  });
});

// ─── SPEC: keyboard-bypass floor (post-audit) ──────────────────────────────
// Pre-audit: `blur` and `disabled` variants used `aria-hidden` +
// `pointer-events-none` + `select-none`. None of those attributes
// remove the subtree from the KEYBOARD tab order — a user could press
// Tab to focus a gated button and hit Enter to activate it. That's
// both a WCAG 2.1.1 violation (focusable content under `aria-hidden`)
// and a soft paywall bypass for any interactive gated UI.
//
// The fix is `inert`, a HTML standard attribute that removes the
// entire subtree from focus traversal AND accessibility tree. These
// tests pin the invariant so a future refactor that drops `inert`
// fails CI.
describe("PlanGate — keyboard-bypass floor", () => {
  beforeEach(() => {
    mockCanUse.mockReturnValue(false);
  });

  it("blur: wrapper has the `inert` attribute so children can't be tabbed to", () => {
    render(
      <PlanGate feature="advancedAnalytics" fallback="blur">
        <button data-testid="gated-btn" onClick={() => {}}>
          Gated action
        </button>
      </PlanGate>,
    );
    const btn = screen.getByTestId("gated-btn");
    // Walk up to find the inert wrapper.
    let node: HTMLElement | null = btn;
    let foundInert = false;
    while (node) {
      if (node.hasAttribute("inert")) {
        foundInert = true;
        break;
      }
      node = node.parentElement;
    }
    expect(foundInert).toBe(true);
  });

  it("disabled: wrapper has the `inert` attribute", () => {
    render(
      <PlanGate feature="advancedAnalytics" fallback="disabled">
        <button data-testid="gated-btn">Gated action</button>
      </PlanGate>,
    );
    const btn = screen.getByTestId("gated-btn");
    let node: HTMLElement | null = btn;
    let foundInert = false;
    while (node) {
      if (node.hasAttribute("inert")) {
        foundInert = true;
        break;
      }
      node = node.parentElement;
    }
    expect(foundInert).toBe(true);
  });

  it("blur: interactive children do NOT respond to click (defense-in-depth)", () => {
    // Even if `inert` somehow gets stripped by a polyfill / older browser,
    // `pointer-events-none` on the wrapper is a second layer that blocks
    // mouse. We pin both layers — `inert` (the primary barrier) above +
    // `pointer-events-none` (this test) so a partial regression is still
    // caught.
    const onClick = vi.fn();
    render(
      <PlanGate feature="advancedAnalytics" fallback="blur">
        <button data-testid="gated-btn" onClick={onClick}>
          Gated action
        </button>
      </PlanGate>,
    );
    // Parent has pointer-events-none — clicking "through" it fires on
    // the backdrop, not the child. happy-dom doesn't fully honor
    // pointer-events in dispatch, so we assert the class directly.
    const btn = screen.getByTestId("gated-btn");
    expect(btn.parentElement).toHaveClass("pointer-events-none");
  });

  it("granted access: children render WITHOUT `inert` (no regression on happy path)", () => {
    mockCanUse.mockReturnValue(true);
    render(
      <PlanGate feature="advancedAnalytics">
        <button data-testid="granted-btn">Allowed action</button>
      </PlanGate>,
    );
    const btn = screen.getByTestId("granted-btn");
    // Walk up the tree: the button must be reachable without crossing
    // an inert boundary.
    let node: HTMLElement | null = btn;
    while (node) {
      expect(node.hasAttribute("inert")).toBe(false);
      node = node.parentElement;
    }
  });
});
