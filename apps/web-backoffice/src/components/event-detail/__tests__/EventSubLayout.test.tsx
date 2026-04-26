import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Settings, Ticket } from "lucide-react";
import { EventSubLayout, type EventSubNavItem } from "../EventSubLayout";

// ─── EventSubLayout — render contract for the sub-section nav shell ──────
//
// Phase O4: every section sub-layout (Configuration / Audience /
// Operations) wraps its sub-pages with this component. Tests pin the
// sub-tab strip rendering, the active-route highlight, the planLocked
// pill, and the section label.

const mockUsePathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const ITEMS: EventSubNavItem[] = [
  {
    id: "infos",
    label: "Infos",
    href: "/events/abc/configuration/infos",
    icon: Settings,
  },
  {
    id: "tickets",
    label: "Billets",
    href: "/events/abc/configuration/tickets",
    icon: Ticket,
    planLocked: true,
  },
];

describe("EventSubLayout — section label + sub-tab strip", () => {
  it("renders the FR section label as a kicker", () => {
    mockUsePathname.mockReturnValue("/events/abc/configuration/infos");
    render(
      <EventSubLayout sectionLabel="Configuration" items={ITEMS}>
        <p>content</p>
      </EventSubLayout>,
    );
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("renders one Link per nav item with the right href + label", () => {
    mockUsePathname.mockReturnValue("/events/abc/configuration/infos");
    render(
      <EventSubLayout sectionLabel="Configuration" items={ITEMS}>
        <p>content</p>
      </EventSubLayout>,
    );

    const infosLink = screen.getByRole("link", { name: /Infos/i });
    expect(infosLink).toHaveAttribute("href", "/events/abc/configuration/infos");

    const ticketsLink = screen.getByRole("link", { name: /Billets/i });
    expect(ticketsLink).toHaveAttribute("href", "/events/abc/configuration/tickets");
  });

  it("marks the active sub-tab via aria-current=page", () => {
    mockUsePathname.mockReturnValue("/events/abc/configuration/tickets");
    render(
      <EventSubLayout sectionLabel="Configuration" items={ITEMS}>
        <p>content</p>
      </EventSubLayout>,
    );

    const ticketsLink = screen.getByRole("link", { name: /Billets/i });
    expect(ticketsLink).toHaveAttribute("aria-current", "page");
    const infosLink = screen.getByRole("link", { name: /Infos/i });
    expect(infosLink).not.toHaveAttribute("aria-current");
  });

  it("highlights an item as active when the current path is a deeper sub-route", () => {
    mockUsePathname.mockReturnValue("/events/abc/configuration/infos/edit");
    render(
      <EventSubLayout sectionLabel="Configuration" items={ITEMS}>
        <p>content</p>
      </EventSubLayout>,
    );
    const infosLink = screen.getByRole("link", { name: /Infos/i });
    expect(infosLink).toHaveAttribute("aria-current", "page");
  });

  it("renders a 'Pro' pill on items with planLocked=true", () => {
    mockUsePathname.mockReturnValue("/events/abc/configuration/infos");
    render(
      <EventSubLayout sectionLabel="Configuration" items={ITEMS}>
        <p>content</p>
      </EventSubLayout>,
    );
    expect(screen.getByText("Pro")).toBeInTheDocument();
    // Only one item is plan-locked; the badge should be unique.
    expect(screen.getAllByText("Pro")).toHaveLength(1);
  });

  it("renders the children content inside the panel", () => {
    mockUsePathname.mockReturnValue("/events/abc/configuration/infos");
    render(
      <EventSubLayout sectionLabel="Configuration" items={ITEMS}>
        <p data-testid="child-content">my child</p>
      </EventSubLayout>,
    );
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });
});
