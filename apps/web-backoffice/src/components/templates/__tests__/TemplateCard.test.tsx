import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TemplateCard } from "../TemplateCard";
import type { EventTemplate } from "@teranga/shared-types";

// ─── TemplateCard — render contract ───────────────────────────────────────
//
// Pure presentational. We assert the FR labels render, the
// stat-pluralisation works, and the click → onSelect contract holds.

const baseTemplate: EventTemplate = {
  id: "workshop",
  category: "workshop",
  label: "Atelier / Workshop",
  tagline: "Format intensif, jauge limitée, tarif unique.",
  description: "Description longue.",
  icon: "GraduationCap",
  defaultDurationHours: 4,
  ticketTypes: [
    {
      id: "tt-workshop",
      name: "Standard",
      price: 15_000,
      totalQuantity: 30,
      saleOpensOffsetDays: 30,
    },
  ],
  sessions: [
    {
      title: "Session principale",
      offsetMinutes: 0,
      durationMinutes: 240,
    },
  ],
  commsBlueprint: [
    {
      id: "wk-reminder-7d",
      offsetDays: -7,
      channels: ["email"],
      title: "Rappel J-7",
      body: "Rappel.",
    },
  ],
  tags: ["formation"],
};

describe("TemplateCard", () => {
  it("renders the label, tagline, and stats", () => {
    const { container } = render(<TemplateCard template={baseTemplate} />);
    expect(container.textContent).toContain("Atelier / Workshop");
    expect(container.textContent).toContain("Format intensif");
    // 1 ticket / 1 session / 1 rappel — all singular forms.
    expect(container.textContent).toContain("1 ticket");
    expect(container.textContent).toContain("1 session");
    expect(container.textContent).toContain("1 rappel");
    expect(container.textContent).toContain("4 h");
    expect(container.textContent).toContain("formation");
  });

  it("uses plural FR labels when there are 2+ items", () => {
    const multi: EventTemplate = {
      ...baseTemplate,
      ticketTypes: [
        baseTemplate.ticketTypes[0],
        { ...baseTemplate.ticketTypes[0], id: "tt-vip", name: "VIP", price: 30000 },
      ],
      sessions: [baseTemplate.sessions[0], baseTemplate.sessions[0]],
      commsBlueprint: [baseTemplate.commsBlueprint[0], baseTemplate.commsBlueprint[0]],
    };
    const { container } = render(<TemplateCard template={multi} />);
    expect(container.textContent).toContain("2 tickets");
    expect(container.textContent).toContain("2 sessions");
    expect(container.textContent).toContain("2 rappels");
  });

  it("invokes onSelect when clicked", () => {
    const onSelect = vi.fn();
    const { getByRole } = render(<TemplateCard template={baseTemplate} onSelect={onSelect} />);
    fireEvent.click(getByRole("button"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("reflects the selected state via aria-pressed", () => {
    const { rerender, getByRole } = render(
      <TemplateCard template={baseTemplate} selected={false} />,
    );
    expect(getByRole("button").getAttribute("aria-pressed")).toBe("false");
    rerender(<TemplateCard template={baseTemplate} selected={true} />);
    expect(getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });
});
