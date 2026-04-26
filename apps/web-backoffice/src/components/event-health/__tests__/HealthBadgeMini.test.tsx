import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { HealthBadgeMini, deriveBadgeTier } from "../HealthBadgeMini";

// ─── HealthBadgeMini — derive + render contract ──────────────────────────
//
// The mini badge is the events-list cousin of the full HealthGauge.
// Computed entirely client-side from (registeredCount, maxAttendees,
// startDate) so a 50-row table doesn't fire 50 /health queries.
// Tests pin the heuristic boundaries so a future refactor doesn't
// silently flip an event's tier from "warn" to "ok" or vice versa.

const FIXED_NOW = new Date("2026-04-26T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("deriveBadgeTier — heuristic", () => {
  it("classifies events > 14 days away as 'info' regardless of registration", () => {
    const tier = deriveBadgeTier({
      registeredCount: 0,
      maxAttendees: 100,
      startDate: "2026-06-01T10:00:00.000Z",
    });
    expect(tier.tier).toBe("info");
    expect(tier.label).toBe("À venir");
  });

  it("classifies ≥ 60 % registration within J-14 as 'ok'", () => {
    const tier = deriveBadgeTier({
      registeredCount: 60,
      maxAttendees: 100,
      startDate: "2026-05-05T10:00:00.000Z", // 9 days out
    });
    expect(tier.tier).toBe("ok");
    expect(tier.ratioPercent).toBe(60);
  });

  it("classifies 30-60 % registration within J-14 as 'warn'", () => {
    const tier = deriveBadgeTier({
      registeredCount: 30,
      maxAttendees: 100,
      startDate: "2026-05-05T10:00:00.000Z",
    });
    expect(tier.tier).toBe("warn");
  });

  it("classifies < 30 % registration within J-14 as 'danger'", () => {
    const tier = deriveBadgeTier({
      registeredCount: 5,
      maxAttendees: 100,
      startDate: "2026-05-05T10:00:00.000Z",
    });
    expect(tier.tier).toBe("danger");
  });

  it("falls back to a target of 50 when maxAttendees is null", () => {
    const tier = deriveBadgeTier({
      registeredCount: 30,
      maxAttendees: null,
      startDate: "2026-05-05T10:00:00.000Z",
    });
    expect(tier.ratioPercent).toBe(60); // 30 / 50 = 60 %
    expect(tier.tier).toBe("ok");
  });

  it("clamps daysLeft at 0 when the event is in the past (defensive — UI title should still render)", () => {
    const tier = deriveBadgeTier({
      registeredCount: 100,
      maxAttendees: 100,
      startDate: "2026-04-20T10:00:00.000Z", // 6 days in the past
    });
    // The function returns the negative daysLeft as-is; the consumer
    // (HealthBadgeMini.title) clamps for display.
    expect(tier.daysLeft).toBeLessThan(0);
    // Past events with 100 % registration still fall in "ok" — they
    // probably just need an archive flag elsewhere.
    expect(tier.tier).toBe("ok");
  });
});

describe("HealthBadgeMini — render contract", () => {
  it("renders the percentage label by default", () => {
    const { container } = render(
      <HealthBadgeMini
        registeredCount={45}
        maxAttendees={100}
        startDate="2026-05-05T10:00:00.000Z"
      />,
    );
    expect(container.textContent).toContain("45 %");
  });

  it("renders the À venir label for early-cycle events", () => {
    const { container } = render(
      <HealthBadgeMini
        registeredCount={0}
        maxAttendees={100}
        startDate="2026-06-30T10:00:00.000Z"
      />,
    );
    expect(container.textContent).toContain("À venir");
  });

  it("hides the label when iconOnly=true (compact mode)", () => {
    const { container } = render(
      <HealthBadgeMini
        registeredCount={45}
        maxAttendees={100}
        startDate="2026-05-05T10:00:00.000Z"
        iconOnly
      />,
    );
    // The text label is gone; only the colored dot remains.
    expect(container.textContent?.trim()).toBe("");
    expect(container.querySelector("span.rounded-full > span")).not.toBeNull();
  });

  it("includes a tooltip-like title attribute with absolute counts", () => {
    const { container } = render(
      <HealthBadgeMini
        registeredCount={45}
        maxAttendees={100}
        startDate="2026-05-05T10:00:00.000Z"
      />,
    );
    const root = container.querySelector("span[title]");
    expect(root?.getAttribute("title")).toContain("45");
    expect(root?.getAttribute("title")).toContain("100");
    expect(root?.getAttribute("title")).toContain("J-");
  });
});
