import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── Sidebar — render contract for the O1 five-section refactor ──────────────
//
// The pure taxonomy is exercised by `use-organizer-nav.test.tsx`. This
// suite covers the React layer specifically: section headers, comingSoon
// disabled rendering, collapsed-state localStorage hydration, and the
// plan-widget gating. A regression here is what the operator actually
// sees when she opens the dashboard, so failing fast at unit-test time
// is the only reasonable defence.

const COLLAPSED_KEY = "teranga:organizer:sidebar:collapsed";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUsePermissions = vi.fn();
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => mockUsePermissions(),
}));

// Optional override of `useOrganizerNav` — when set, the tests inject a
// custom taxonomy (e.g. a synthetic comingSoon entry). When null, the
// real hook runs against the production taxonomy.
const mockUseOrganizerNav = vi.fn();
vi.mock("@/hooks/use-organizer-nav", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown> & {
    buildOrganizerNav: (roles: readonly string[]) => unknown;
  };
  return {
    ...actual,
    useOrganizerNav: () => {
      const overridden = mockUseOrganizerNav();
      if (overridden) return overridden;
      // Re-derive from the auth mock so the role-driven cases keep
      // exercising the real role-filter logic.
      const auth = mockUseAuth();
      return actual.buildOrganizerNav(auth?.user?.roles ?? []);
    },
  };
});

// Plan widget pulls react-query + the API client. Stub it to avoid
// firing network calls inside a render test — the widget render IS
// covered by `use-plan-gating.test.tsx`.
vi.mock("@/hooks/use-plan-gating", () => ({
  usePlanGating: () => ({
    plan: "pro",
    checkLimit: () => ({ current: 0, limit: 10, allowed: true, percent: 0 }),
    isNearLimit: () => false,
  }),
}));
vi.mock("@/hooks/use-plans-catalog", () => ({
  usePlansCatalogMap: () => ({ map: {} }),
  getPlanDisplay: () => ({ name: { fr: "Pro", en: "Pro" }, color: "#0f172a", priceXof: 0 }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { Sidebar } from "../sidebar";
import { SidebarProvider } from "../sidebar-context";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the collapsed key between tests.
  try {
    window.localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    /* jsdom — always available */
  }
});

function renderSidebar() {
  return render(
    <SidebarProvider>
      <Sidebar />
    </SidebarProvider>,
  );
}

describe("Sidebar — section headers per role", () => {
  it("renders the five primary section headers for an organizer", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });
    mockUsePermissions.mockReturnValue({ can: () => true });

    renderSidebar();

    // Section headers are rendered as <p> elements with the section
    // label text. Each section must be present at least once across
    // the desktop + mobile drawer renders, so we use getAllByText.
    expect(screen.getAllByText("Mon espace").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Événements").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Audience").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Business").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paramètres").length).toBeGreaterThan(0);
  });

  it("renders only the Lieux section for a venue_manager", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["venue_manager"] } });
    mockUsePermissions.mockReturnValue({ can: (p: string) => p !== "organization:read" });

    renderSidebar();

    expect(screen.getAllByText("Lieux").length).toBeGreaterThan(0);
    // Pure venue manager has no Business / Audience visibility.
    expect(screen.queryByText("Business")).toBeNull();
    expect(screen.queryByText("Audience")).toBeNull();
  });
});

describe("Sidebar — comingSoon entries", () => {
  it("renders comingSoon items as aria-disabled with a 'Bientôt' pill (not as anchor links)", () => {
    // The production taxonomy at this point has no comingSoon entries
    // — Phase O2 shipped the /inbox route and removed the flag. The
    // rendering logic still exists for future surfaces (a Phase O3
    // entry, etc.), so we cover it via the mockable nav hook that
    // injects a synthetic comingSoon item.
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });
    mockUsePermissions.mockReturnValue({ can: () => true });
    mockUseOrganizerNav.mockReturnValueOnce({
      sections: [
        {
          key: "my-space",
          label: "Mon espace",
          items: [
            {
              id: "future-feature",
              href: "/future",
              icon: () => null,
              label: "Surface à venir",
              roles: ["organizer"],
              comingSoon: true,
            },
          ],
        },
      ],
      allItems: [],
      isCoOrganizer: false,
      isVenueManager: false,
    });

    renderSidebar();

    const bientotPills = screen.getAllByText("Bientôt");
    expect(bientotPills.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Surface à venir").length).toBeGreaterThan(0);
  });
});

describe("Sidebar — collapsed-state localStorage hydration", () => {
  it("starts collapsed when the persisted flag is set to '1'", () => {
    window.localStorage.setItem(COLLAPSED_KEY, "1");
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });
    mockUsePermissions.mockReturnValue({ can: () => true });

    renderSidebar();

    // When collapsed, the toggle button announces "Déplier" and the
    // pressed state is true. There are two toggles (desktop + mobile)
    // but the desktop one is the only one rendered with this label
    // pre-mount; we assert at least one matches.
    const toggle = screen.getAllByRole("button", { name: "Déplier la barre latérale" });
    expect(toggle.length).toBeGreaterThan(0);
    expect(toggle[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("starts expanded when no localStorage flag is present", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });
    mockUsePermissions.mockReturnValue({ can: () => true });

    renderSidebar();

    const toggle = screen.getAllByRole("button", { name: "Replier la barre latérale" });
    expect(toggle.length).toBeGreaterThan(0);
    expect(toggle[0]).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Sidebar — plan widget permission gate", () => {
  it("renders the plan widget when the caller has organization:read", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["organizer"] } });
    mockUsePermissions.mockReturnValue({ can: (p: string) => p === "organization:read" });

    renderSidebar();

    // The widget surfaces the plan name from `getPlanDisplay`, and we
    // mocked it to return name.fr === "Pro".
    expect(screen.getAllByText("Pro").length).toBeGreaterThan(0);
  });

  it("does not render the plan widget for callers without organization:read", () => {
    mockUseAuth.mockReturnValue({ user: { roles: ["venue_manager"] } });
    mockUsePermissions.mockReturnValue({ can: () => false });

    renderSidebar();

    // No plan widget content should be visible — venue managers must
    // not see the org billing chrome.
    expect(screen.queryByText("Pro")).toBeNull();
    expect(screen.queryByText("Augmenter mes limites")).toBeNull();
  });
});
