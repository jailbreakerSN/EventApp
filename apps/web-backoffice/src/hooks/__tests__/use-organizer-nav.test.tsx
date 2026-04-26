import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { buildOrganizerNav, useOrganizerNav } from "../use-organizer-nav";

// ─── useOrganizerNav — single source of truth for sidebar/palette/switcher ───
//
// O1 closure: sidebar, command palette, event switcher and breadcrumbs all
// consume this hook. Tests pin the role → section visibility contract so a
// future change to the taxonomy that accidentally hides Finance from
// organizers (or shows Venues to a co-organizer) breaks here, not at
// runtime in front of an operator.

const mockUseAuth = vi.fn();
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockUseAuth(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildOrganizerNav — pure role-filter (no React)", () => {
  it("organizer sees the four primary sections plus Settings, no Venues", () => {
    const ctx = buildOrganizerNav(["organizer"]);

    const keys = ctx.sections.map((s) => s.key);
    expect(keys).toEqual(["my-space", "events", "audience", "business", "settings"]);
    // Venues is venue_manager-scoped — pure organizer never sees it.
    expect(keys).not.toContain("venues");
    expect(ctx.isCoOrganizer).toBe(false);
    expect(ctx.isVenueManager).toBe(false);
  });

  it("co_organizer loses Audience.Participants, Business.Finance and Business.Organization", () => {
    const ctx = buildOrganizerNav(["co_organizer"]);

    const audience = ctx.sections.find((s) => s.key === "audience");
    expect(audience?.items.map((i) => i.id)).toEqual(["communications", "notifications"]);

    // Business section is dropped entirely — every item required `organizer`
    // and a co-organizer holds none of them.
    expect(ctx.sections.find((s) => s.key === "business")).toBeUndefined();

    // Settings still present — both items remain visible to co_organizer
    // (billing has been intentionally restricted to organizer in the
    // taxonomy, so for a co_organizer the section narrows to Préférences).
    const settings = ctx.sections.find((s) => s.key === "settings");
    expect(settings?.items.map((i) => i.id)).toEqual(["settings"]);

    expect(ctx.isCoOrganizer).toBe(true);
  });

  it("venue_manager sees only the Venues section", () => {
    const ctx = buildOrganizerNav(["venue_manager"]);

    expect(ctx.sections.map((s) => s.key)).toEqual(["venues"]);
    expect(ctx.sections[0].items.map((i) => i.id)).toEqual(["venues"]);
    expect(ctx.isVenueManager).toBe(true);
  });

  it("super_admin sees every section, including Venues", () => {
    const ctx = buildOrganizerNav(["super_admin"]);

    expect(ctx.sections.map((s) => s.key)).toEqual([
      "my-space",
      "events",
      "audience",
      "business",
      "venues",
      "settings",
    ]);
    expect(ctx.isCoOrganizer).toBe(false);
    expect(ctx.isVenueManager).toBe(false);
  });

  it("combines roles via union — organizer + venue_manager sees both worlds", () => {
    const ctx = buildOrganizerNav(["organizer", "venue_manager"]);

    expect(ctx.sections.map((s) => s.key)).toContain("venues");
    expect(ctx.sections.map((s) => s.key)).toContain("business");
    expect(ctx.isCoOrganizer).toBe(false);
    expect(ctx.isVenueManager).toBe(false); // because organizer is ALSO present
  });

  it("empty role list yields zero sections — used by signed-out / pre-login render guards", () => {
    const ctx = buildOrganizerNav([]);

    expect(ctx.sections).toHaveLength(0);
    expect(ctx.allItems).toHaveLength(0);
  });

  it("allItems is the flat union of every visible section's items, in order", () => {
    const ctx = buildOrganizerNav(["organizer"]);

    const flatFromSections = ctx.sections.flatMap((s) => s.items);
    expect(ctx.allItems).toEqual(flatFromSections);
    // First two items are always Inbox + Dashboard for an organizer (My Space).
    expect(ctx.allItems.slice(0, 2).map((i) => i.id)).toEqual(["inbox", "dashboard"]);
  });

  it("every item has a stable id, an absolute href, and a non-empty label", () => {
    const ctx = buildOrganizerNav(["super_admin"]);
    for (const item of ctx.allItems) {
      expect(item.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.label.length).toBeGreaterThan(0);
      // Roles must be a non-empty array — every item must be reachable
      // by at least one role, otherwise it's dead taxonomy.
      expect(item.roles.length).toBeGreaterThan(0);
    }
  });
});

describe("useOrganizerNav — React hook integration with useAuth", () => {
  it("returns empty sections when there is no user (pre-auth render)", () => {
    mockUseAuth.mockReturnValue({ user: null });

    const { result } = renderHook(() => useOrganizerNav());

    expect(result.current.sections).toHaveLength(0);
    expect(result.current.allItems).toHaveLength(0);
  });

  it("derives sections from the authenticated user's roles", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });

    const { result } = renderHook(() => useOrganizerNav());

    expect(result.current.sections.length).toBeGreaterThan(0);
    expect(result.current.sections.map((s) => s.key)).toContain("business");
  });

  it("memoises stably for identical role sets across renders", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });

    const { result, rerender } = renderHook(() => useOrganizerNav());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
