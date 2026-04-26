import { describe, it, expect, vi, beforeEach } from "vitest";
import { groupEvents, normaliseSearchTerm } from "../event-switcher-utils";
import type { Event as TerangaEvent } from "@teranga/shared-types";

// ─── Render-test mocks (must be hoisted by vitest) ───────────────────────────
const mockUseEvents = vi.fn();
const mockUsePermissions = vi.fn();
const mockUseRouter = vi.fn();
const mockUseParams = vi.fn();
const mockUsePathname = vi.fn();

vi.mock("@/hooks/use-events", () => ({
  useEvents: () => mockUseEvents(),
}));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => mockUsePermissions(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mockUseRouter(),
  useParams: () => mockUseParams(),
  usePathname: () => mockUsePathname(),
}));

// ─── Event Switcher — pure groupEvents() lifecycle bucketing ─────────────────
//
// The switcher's keyboard navigation, search filter and "Courant" pill
// all sit on top of one piece of pure logic: which events go into the
// "En cours / À venir / Brouillons" buckets at a given `now`. Pinning
// that logic in unit tests gives us confidence the rest of the React
// component is just rendering — and lets us refactor the JSX without
// re-running the browser.

const NOW = new Date("2026-04-26T12:00:00.000Z");

function buildEvent(partial: Partial<TerangaEvent> & { id: string }): TerangaEvent {
  // Minimum-viable event matching the schema in `event.types.ts`. We
  // only fill the fields the switcher actually inspects (status,
  // startDate, endDate, updatedAt, title) — the rest defaults to
  // empty strings / sensible neutrals so the type-check passes.
  // Spread `partial` last so caller-supplied overrides win.
  const base = {
    organizationId: "org-1",
    slug: partial.id,
    title: `Event ${partial.id}`,
    description: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "u-1",
    status: "draft" as const,
    format: "in_person" as const,
    category: "conference" as const,
    startDate: null,
    endDate: null,
    timezone: "Africa/Dakar",
    locale: "fr",
    currency: "XOF",
  };
  return { ...base, ...partial } as TerangaEvent;
}

describe("groupEvents — lifecycle bucketing", () => {
  it("places a published event whose window straddles `now` in the live group", () => {
    const live = buildEvent({
      id: "live-1",
      status: "published",
      startDate: "2026-04-26T10:00:00.000Z",
      endDate: "2026-04-26T18:00:00.000Z",
    });
    const groups = groupEvents([live], NOW);
    expect(groups.map((g) => g.key)).toEqual(["live"]);
    expect(groups[0].events).toEqual([live]);
  });

  it("places a future-published event in upcoming, not live", () => {
    const future = buildEvent({
      id: "fut-1",
      status: "published",
      startDate: "2026-05-10T09:00:00.000Z",
      endDate: "2026-05-10T17:00:00.000Z",
    });
    const groups = groupEvents([future], NOW);
    expect(groups.map((g) => g.key)).toEqual(["upcoming"]);
  });

  it("places a draft regardless of dates in the drafts group", () => {
    const draft = buildEvent({
      id: "draft-1",
      status: "draft",
      // Past date — the bucketing must STILL surface it as a draft
      // (the operator wants to finish editing it).
      startDate: "2026-01-15T10:00:00.000Z",
    });
    const groups = groupEvents([draft], NOW);
    expect(groups.map((g) => g.key)).toEqual(["drafts"]);
  });

  it("excludes cancelled / completed / archived events entirely", () => {
    const cancelled = buildEvent({
      id: "c-1",
      status: "cancelled",
      startDate: "2026-05-01T00:00:00.000Z",
    });
    const completed = buildEvent({
      id: "c-2",
      status: "completed",
      startDate: "2026-04-01T00:00:00.000Z",
    });
    const archived = buildEvent({
      id: "c-3",
      status: "archived",
      startDate: "2026-03-01T00:00:00.000Z",
    });

    const groups = groupEvents([cancelled, completed, archived], NOW);
    expect(groups).toHaveLength(0);
  });

  it("excludes a past published event whose end is before `now` (no live, no upcoming)", () => {
    const past = buildEvent({
      id: "past-1",
      status: "published",
      startDate: "2026-03-01T10:00:00.000Z",
      endDate: "2026-03-01T18:00:00.000Z",
    });
    const groups = groupEvents([past], NOW);
    // The switcher's contract: only actionable destinations. A past
    // event you forgot to mark `completed` is not a switch target —
    // the operator reaches for /events to fix that.
    expect(groups).toHaveLength(0);
  });

  it("orders upcoming by ascending startDate (next event first)", () => {
    const e1 = buildEvent({
      id: "u-1",
      status: "published",
      startDate: "2026-06-01T10:00:00.000Z",
    });
    const e2 = buildEvent({
      id: "u-2",
      status: "published",
      startDate: "2026-05-05T10:00:00.000Z",
    });
    const e3 = buildEvent({
      id: "u-3",
      status: "published",
      startDate: "2026-05-15T10:00:00.000Z",
    });

    const groups = groupEvents([e1, e2, e3], NOW);
    const upcoming = groups.find((g) => g.key === "upcoming");
    expect(upcoming?.events.map((e) => e.id)).toEqual(["u-2", "u-3", "u-1"]);
  });

  it("orders drafts by descending updatedAt (most-recently-edited first)", () => {
    const old = buildEvent({
      id: "d-old",
      status: "draft",
      updatedAt: "2026-01-15T10:00:00.000Z",
    });
    const fresh = buildEvent({
      id: "d-fresh",
      status: "draft",
      updatedAt: "2026-04-25T10:00:00.000Z",
    });
    const mid = buildEvent({
      id: "d-mid",
      status: "draft",
      updatedAt: "2026-03-10T10:00:00.000Z",
    });

    const groups = groupEvents([old, fresh, mid], NOW);
    const drafts = groups.find((g) => g.key === "drafts");
    expect(drafts?.events.map((e) => e.id)).toEqual(["d-fresh", "d-mid", "d-old"]);
  });

  it("preserves group order Live → Upcoming → Drafts when all three bucket types are present", () => {
    const live = buildEvent({
      id: "L",
      status: "published",
      startDate: "2026-04-26T10:00:00.000Z",
      endDate: "2026-04-26T18:00:00.000Z",
    });
    const future = buildEvent({
      id: "F",
      status: "published",
      startDate: "2026-05-01T10:00:00.000Z",
    });
    const draft = buildEvent({ id: "D", status: "draft" });

    const groups = groupEvents([draft, future, live], NOW);
    expect(groups.map((g) => g.key)).toEqual(["live", "upcoming", "drafts"]);
  });

  it("returns an empty array when no events qualify (signed-in but no events yet)", () => {
    expect(groupEvents([], NOW)).toEqual([]);
  });
});

describe("normaliseSearchTerm — accent + case insensitive search", () => {
  it("strips diacritics so « Évènement » matches « evenement »", () => {
    expect(normaliseSearchTerm("Évènement")).toBe("evenement");
  });

  it("trims whitespace so a trailing space doesn't shadow matches", () => {
    expect(normaliseSearchTerm("  Conférence  ")).toBe("conference");
  });

  it("returns the empty string for an empty input — used by the no-filter fallback", () => {
    expect(normaliseSearchTerm("")).toBe("");
  });
});

// ─── React render tests ──────────────────────────────────────────────────────
describe("EventSwitcher — React render contract", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockUseRouter.mockReturnValue({ push: vi.fn() });
    mockUseParams.mockReturnValue({});
    mockUsePathname.mockReturnValue("/dashboard");
    mockUseEvents.mockReturnValue({ data: { data: [] }, isLoading: false });
  });

  it("returns null when the caller lacks event:read", async () => {
    mockUsePermissions.mockReturnValue({ can: () => false });
    const { render } = await import("@testing-library/react");
    const { EventSwitcher } = await import("../event-switcher");

    const { container } = render(<EventSwitcher />);
    // No DOM produced — gating hides the trigger entirely for venue
    // managers / staff who don't own events.
    expect(container.firstChild).toBeNull();
  });

  it("renders a closed trigger with the placeholder when no event is in scope", async () => {
    mockUsePermissions.mockReturnValue({ can: () => true });
    const { render, screen } = await import("@testing-library/react");
    const { EventSwitcher } = await import("../event-switcher");

    render(<EventSwitcher />);

    const trigger = screen.getByRole("button", { name: "Choisir un événement" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("opens the popover on click and surfaces the search input", async () => {
    mockUsePermissions.mockReturnValue({ can: () => true });
    const liveEvent = buildEvent({
      id: "live-1",
      title: "Workshop Dakar",
      status: "published",
      startDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      endDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    mockUseEvents.mockReturnValue({ data: { data: [liveEvent] }, isLoading: false });

    const { render, screen, fireEvent } = await import("@testing-library/react");
    const { EventSwitcher } = await import("../event-switcher");

    render(<EventSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Choisir un événement" }));

    expect(
      screen.getByRole("button", {
        name: /Événement courant : Workshop Dakar|Choisir un événement/i,
      }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByPlaceholderText("Rechercher un événement…")).toBeInTheDocument();
    expect(screen.getByText("En cours")).toBeInTheDocument();
    expect(screen.getByText("Workshop Dakar")).toBeInTheDocument();
  });

  it("displays the 'Courant' pill on the active event row when event-scoped", async () => {
    mockUsePermissions.mockReturnValue({ can: () => true });
    mockUseParams.mockReturnValue({ eventId: "abc" });
    mockUsePathname.mockReturnValue("/events/abc");
    const ev = buildEvent({
      id: "abc",
      title: "Hackathon",
      status: "published",
      startDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    mockUseEvents.mockReturnValue({ data: { data: [ev] }, isLoading: false });

    const { render, screen, fireEvent } = await import("@testing-library/react");
    const { EventSwitcher } = await import("../event-switcher");

    render(<EventSwitcher />);
    // Trigger label reflects the current event title.
    fireEvent.click(screen.getByRole("button", { name: /Événement courant : Hackathon/i }));
    expect(screen.getByText("Courant")).toBeInTheDocument();
  });

  it("filters the list as the user types in the search input", async () => {
    mockUsePermissions.mockReturnValue({ can: () => true });
    const e1 = buildEvent({
      id: "e1",
      title: "Workshop Dakar",
      status: "published",
      startDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    const e2 = buildEvent({
      id: "e2",
      title: "Conférence Tech",
      status: "published",
      startDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    mockUseEvents.mockReturnValue({ data: { data: [e1, e2] }, isLoading: false });

    const { render, screen, fireEvent } = await import("@testing-library/react");
    const { EventSwitcher } = await import("../event-switcher");

    render(<EventSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Choisir un événement" }));

    const search = screen.getByPlaceholderText("Rechercher un événement…");
    fireEvent.change(search, { target: { value: "tech" } });

    expect(screen.getByText("Conférence Tech")).toBeInTheDocument();
    expect(screen.queryByText("Workshop Dakar")).toBeNull();
  });
});
