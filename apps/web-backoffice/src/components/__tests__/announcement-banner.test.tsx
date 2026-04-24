import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import frMessages from "@/i18n/messages/fr.json";

/**
 * T5.3 — `AnnouncementBanner` contract tests.
 *
 * Three regression targets:
 *   1. Severity routing → correct container + icon + role (critical
 *      renders `role="alert"`, others `role="status"`).
 *   2. Dismissal persistence — localStorage keyed per-id survives a
 *      remount (5-min poll), and critical banners cannot be dismissed.
 *   3. No network, no banners, no crash — the SSR/first-render path
 *      must render the always-mounted `role="status"` live region.
 */

const mockGet = vi.fn();

vi.mock("@/lib/api-client", () => ({
  api: {
    get: (path: string) => mockGet(path),
  },
}));

// Import AFTER mocks.
import { AnnouncementBanner } from "../announcement-banner";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

describe("AnnouncementBanner — empty response", () => {
  it("renders an empty sr-only live region (never null) when the API returns no rows", async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });
    const { container } = render(<AnnouncementBanner />, { wrapper });

    // Wait for the query to resolve so the component has its data.
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    // sr-only live region is always mounted — NVDA/JAWS need it to
    // announce banners that arrive after first render.
    const liveRegion = container.querySelector('[role="status"]');
    expect(liveRegion).toBeInTheDocument();
  });
});

describe("AnnouncementBanner — severity routing", () => {
  it("renders an info banner with role='status' for severity: info", async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [
        {
          id: "a1",
          title: "Nouvelle fonctionnalité",
          body: "Les clés API sont disponibles.",
          severity: "info",
          audience: "all",
          publishedAt: "2026-04-20T00:00:00Z",
          active: true,
        },
      ],
    });
    render(<AnnouncementBanner />, { wrapper });
    await screen.findByText("Nouvelle fonctionnalité");

    const banner = screen.getByText("Nouvelle fonctionnalité").closest("div");
    expect(banner?.parentElement).toHaveAttribute("role", "status");
  });

  it("renders a critical banner with role='alert' and no dismiss button", async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [
        {
          id: "c1",
          title: "Maintenance en cours",
          body: "Interruption de service imminente",
          severity: "critical",
          audience: "all",
          publishedAt: "2026-04-20T00:00:00Z",
          active: true,
        },
      ],
    });
    render(<AnnouncementBanner />, { wrapper });
    await screen.findByText("Maintenance en cours");

    const banner = screen.getByText("Maintenance en cours").closest("div");
    expect(banner?.parentElement).toHaveAttribute("role", "alert");

    // Critical banners cannot be dismissed.
    expect(screen.queryByRole("button", { name: /Fermer/i })).not.toBeInTheDocument();
  });
});

describe("AnnouncementBanner — dismissal", () => {
  it("persists per-id dismissal in localStorage and hides the banner on re-mount", async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [
        {
          id: "a1",
          title: "Dismissible",
          body: "Click the X",
          severity: "info",
          audience: "all",
          publishedAt: "2026-04-20T00:00:00Z",
          active: true,
        },
      ],
    });

    const { unmount } = render(<AnnouncementBanner />, { wrapper });
    await screen.findByText("Dismissible");

    const dismissButton = screen.getByRole("button", { name: /Fermer/i });
    await userEvent.click(dismissButton);

    // Dismiss marker written to localStorage.
    expect(localStorage.getItem("teranga:announcement-dismissed:a1")).toBe("1");

    unmount();

    // Re-mount + same API response → banner stays hidden.
    render(<AnnouncementBanner />, { wrapper });
    // Wait enough for the query to resolve.
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Dismissible")).not.toBeInTheDocument();
  });

  it("prioritises a critical banner over a newer info banner", async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [
        {
          id: "newInfo",
          title: "Just a heads up",
          body: "…",
          severity: "info",
          audience: "all",
          publishedAt: "2026-04-21T00:00:00Z",
          active: true,
        },
        {
          id: "oldCrit",
          title: "Critical outage",
          body: "…",
          severity: "critical",
          audience: "all",
          publishedAt: "2026-04-19T00:00:00Z",
          active: true,
        },
      ],
    });
    render(<AnnouncementBanner />, { wrapper });
    await screen.findByText("Critical outage");
    expect(screen.queryByText("Just a heads up")).not.toBeInTheDocument();
  });
});
