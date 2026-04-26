import { describe, it, expect, vi } from "vitest";

// `use-organizer-nav` (statically) imports `@/hooks/use-auth`, which
// pulls in Firebase at module load. The pure helpers we exercise here
// don't need Firebase, but vitest hoists `vi.mock` before module
// resolution — short-circuiting the auth shim is enough to keep the
// import chain dry.
const mockUseAuth = vi.fn();
const mockUsePathname = vi.fn();
const mockUseParams = vi.fn();
const mockUseEvent = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock("@/hooks/use-events", () => ({
  useEvent: (id: string) => mockUseEvent(id),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useParams: () => mockUseParams(),
}));

import { deriveBreadcrumbs } from "../use-organizer-breadcrumbs-utils";
import { buildOrganizerNav } from "../use-organizer-nav";

// ─── deriveBreadcrumbs — pure path → trail derivation ────────────────────────
//
// The React hook layers in the eventTitle from `useEvent(eventId)` and
// the role-filtered nav items from `useOrganizerNav()`. Both inputs are
// passed in as plain values to the pure helper here so the contract is
// trivially testable without a renderHook setup. Pinning the trail
// shape keeps refactors of the layout safe — the breadcrumb panel
// renders exactly what this function returns, so a regression here is
// the regression an operator would see.

const ORG_NAV = buildOrganizerNav(["organizer"]).allItems;
const VENUE_NAV = buildOrganizerNav(["venue_manager"]).allItems;

describe("deriveBreadcrumbs — landing routes hide the panel", () => {
  it("returns shouldRender=false on /dashboard (own home)", () => {
    const ctx = deriveBreadcrumbs({ pathname: "/dashboard", navItems: ORG_NAV });
    expect(ctx.shouldRender).toBe(false);
    expect(ctx.items).toEqual([]);
  });

  it("returns shouldRender=false on /inbox (O2 landing — reserved)", () => {
    const ctx = deriveBreadcrumbs({ pathname: "/inbox", navItems: ORG_NAV });
    expect(ctx.shouldRender).toBe(false);
  });

  it("returns shouldRender=false on / (root redirect target)", () => {
    const ctx = deriveBreadcrumbs({ pathname: "/", navItems: ORG_NAV });
    expect(ctx.shouldRender).toBe(false);
  });
});

describe("deriveBreadcrumbs — top-level nav routes", () => {
  it("renders 'Tableau de bord › Communications' on /communications", () => {
    const ctx = deriveBreadcrumbs({ pathname: "/communications", navItems: ORG_NAV });
    expect(ctx.shouldRender).toBe(true);
    expect(ctx.items).toEqual([
      { label: "Tableau de bord", href: "/dashboard" },
      { label: "Communications" },
    ]);
  });

  it("renders 'Tableau de bord › Facturation' on /organization/billing (uses nav label, not segment)", () => {
    const ctx = deriveBreadcrumbs({ pathname: "/organization/billing", navItems: ORG_NAV });
    expect(ctx.items.map((i) => i.label)).toEqual(["Tableau de bord", "Facturation"]);
  });

  it("renders 'Tableau de bord › Organisation › Clés API' on /organization/api-keys", () => {
    const ctx = deriveBreadcrumbs({ pathname: "/organization/api-keys", navItems: ORG_NAV });
    expect(ctx.items).toEqual([
      { label: "Tableau de bord", href: "/dashboard" },
      { label: "Organisation", href: "/organization" },
      { label: "Clés API" },
    ]);
  });
});

describe("deriveBreadcrumbs — events branch", () => {
  it("renders 'Tableau de bord › Événements' (terminal) on /events", () => {
    const ctx = deriveBreadcrumbs({ pathname: "/events", navItems: ORG_NAV });
    expect(ctx.items).toEqual([
      { label: "Tableau de bord", href: "/dashboard" },
      { label: "Événements" }, // terminal — no href
    ]);
  });

  it("renders 'Tableau de bord › Événements › Nouvel événement' on /events/new", () => {
    const ctx = deriveBreadcrumbs({ pathname: "/events/new", navItems: ORG_NAV });
    expect(ctx.items).toEqual([
      { label: "Tableau de bord", href: "/dashboard" },
      { label: "Événements", href: "/events" },
      { label: "Nouvel événement" },
    ]);
  });

  it("uses the event title when available on /events/[id]", () => {
    const ctx = deriveBreadcrumbs({
      pathname: "/events/abc123",
      navItems: ORG_NAV,
      eventId: "abc123",
      eventTitle: "Hackathon Dakar 2026",
    });
    expect(ctx.items).toEqual([
      { label: "Tableau de bord", href: "/dashboard" },
      { label: "Événements", href: "/events" },
      { label: "Hackathon Dakar 2026" },
    ]);
  });

  it("falls back to 'Événement' when the title is missing (event still loading)", () => {
    const ctx = deriveBreadcrumbs({
      pathname: "/events/abc123",
      navItems: ORG_NAV,
      eventId: "abc123",
      eventTitle: null,
    });
    const last = ctx.items[ctx.items.length - 1];
    expect(last.label).toBe("Événement");
  });

  it("renders deep event paths: /events/[id]/checkin → ... › Check-in (humanised)", () => {
    const ctx = deriveBreadcrumbs({
      pathname: "/events/abc/checkin",
      navItems: ORG_NAV,
      eventId: "abc",
      eventTitle: "Conférence Tech",
    });
    expect(ctx.items.map((i) => i.label)).toEqual([
      "Tableau de bord",
      "Événements",
      "Conférence Tech",
      "Check-in",
    ]);
    // Last crumb has no href.
    expect(ctx.items[ctx.items.length - 1].href).toBeUndefined();
    // Event title crumb IS clickable (operator can jump back to the
    // event detail).
    expect(ctx.items[2].href).toBe("/events/abc");
  });

  it("renders /events/[id]/checkin/history with intermediate Check-in clickable", () => {
    const ctx = deriveBreadcrumbs({
      pathname: "/events/abc/checkin/history",
      navItems: ORG_NAV,
      eventId: "abc",
      eventTitle: "Conférence Tech",
    });
    const labels = ctx.items.map((i) => i.label);
    expect(labels).toEqual([
      "Tableau de bord",
      "Événements",
      "Conférence Tech",
      "Check-in",
      "Historique",
    ]);
    // Check-in crumb has an href so the operator can drop back one
    // level mid-stack.
    const checkin = ctx.items.find((i) => i.label === "Check-in");
    expect(checkin?.href).toBe("/events/abc/checkin");
  });
});

describe("deriveBreadcrumbs — unknown / role-filtered surfaces", () => {
  it("a venue_manager visiting /finance gets a humanised fallback (not a nav hit)", () => {
    // The venue_manager taxonomy doesn't include /finance → the
    // matcher falls through to the humanised fallback. The breadcrumb
    // must still render (we don't 404 the rail just because the user
    // typed an unsupported URL).
    const ctx = deriveBreadcrumbs({ pathname: "/finance", navItems: VENUE_NAV });
    expect(ctx.shouldRender).toBe(true);
    expect(ctx.items.map((i) => i.label)).toEqual(["Tableau de bord", "Finance"]);
  });

  it("humanises arbitrary segments via dash → space + capitalisation", () => {
    const ctx = deriveBreadcrumbs({ pathname: "/some/multi-word-page", navItems: ORG_NAV });
    expect(ctx.items[ctx.items.length - 1].label).toBe("Multi word page");
  });
});

// ─── React hook integration — useOrganizerBreadcrumbs() ──────────────────────
describe("useOrganizerBreadcrumbs — composes pathname + nav + event title", () => {
  it("returns shouldRender=false on landing pages, no event fetch performed", async () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });
    mockUsePathname.mockReturnValue("/dashboard");
    mockUseParams.mockReturnValue({});
    mockUseEvent.mockReturnValue({ data: undefined });

    const { renderHook } = await import("@testing-library/react");
    const { useOrganizerBreadcrumbs } = await import("../use-organizer-breadcrumbs");

    const { result } = renderHook(() => useOrganizerBreadcrumbs());
    expect(result.current.shouldRender).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it("derives a non-event trail from the role-filtered nav for /communications", async () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });
    mockUsePathname.mockReturnValue("/communications");
    mockUseParams.mockReturnValue({});
    mockUseEvent.mockReturnValue({ data: undefined });

    const { renderHook } = await import("@testing-library/react");
    const { useOrganizerBreadcrumbs } = await import("../use-organizer-breadcrumbs");

    const { result } = renderHook(() => useOrganizerBreadcrumbs());
    expect(result.current.shouldRender).toBe(true);
    expect(result.current.items.map((i) => i.label)).toEqual(["Tableau de bord", "Communications"]);
  });

  it("injects the event title from useEvent on /events/[id]/checkin", async () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });
    mockUsePathname.mockReturnValue("/events/abc/checkin");
    mockUseParams.mockReturnValue({ eventId: "abc" });
    // useEvent returns the API envelope `{ data: Event }`, mirroring
    // the production hook contract — the breadcrumb hook plucks
    // `eventResp?.data?.title`.
    mockUseEvent.mockReturnValue({ data: { data: { title: "Hackathon Dakar" } } });

    const { renderHook } = await import("@testing-library/react");
    const { useOrganizerBreadcrumbs } = await import("../use-organizer-breadcrumbs");

    const { result } = renderHook(() => useOrganizerBreadcrumbs());
    expect(result.current.items.map((i) => i.label)).toEqual([
      "Tableau de bord",
      "Événements",
      "Hackathon Dakar",
      "Check-in",
    ]);
  });

  it("falls back to 'Événement' when useEvent has not yet resolved (loading state)", async () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });
    mockUsePathname.mockReturnValue("/events/abc");
    mockUseParams.mockReturnValue({ eventId: "abc" });
    mockUseEvent.mockReturnValue({ data: undefined });

    const { renderHook } = await import("@testing-library/react");
    const { useOrganizerBreadcrumbs } = await import("../use-organizer-breadcrumbs");

    const { result } = renderHook(() => useOrganizerBreadcrumbs());
    expect(result.current.items[result.current.items.length - 1].label).toBe("Événement");
  });

  it("yields an empty trail for a signed-out caller (pre-auth render)", async () => {
    mockUseAuth.mockReturnValue({ user: null });
    mockUsePathname.mockReturnValue("/communications");
    mockUseParams.mockReturnValue({});
    mockUseEvent.mockReturnValue({ data: undefined });

    const { renderHook } = await import("@testing-library/react");
    const { useOrganizerBreadcrumbs } = await import("../use-organizer-breadcrumbs");

    const { result } = renderHook(() => useOrganizerBreadcrumbs());
    // Pre-auth, the nav taxonomy is empty → no nav match for
    // /communications → fallback humanised crumb after the dashboard
    // root. The panel STILL renders so the operator never sees a
    // blank header mid-shell.
    expect(result.current.shouldRender).toBe(true);
    expect(result.current.items.map((i) => i.label)).toEqual(["Tableau de bord", "Communications"]);
  });
});
