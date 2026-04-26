import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockUsePathname = vi.fn();
const mockSearchParams = new URLSearchParams("status=published");
const mockUseSearchParams = vi.fn(() => mockSearchParams);
const mockRouterPush = vi.fn();
const mockUseRouter = vi.fn(() => ({ push: mockRouterPush }));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => mockUseRouter(),
}));

import { SavedViewsMenu } from "../SavedViewsMenu";

beforeEach(() => {
  vi.clearAllMocks();
  mockUsePathname.mockReturnValue("/participants");
  // Reset localStorage between tests so saved views from one test
  // don't leak into the next.
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom always available */
  }
});

describe("SavedViewsMenu — dropdown lifecycle", () => {
  it("renders the trigger with the placeholder label when no view is active", () => {
    render(<SavedViewsMenu surfaceKey="test" />);
    const trigger = screen.getByRole("button", { name: /Vues/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the panel on click and shows the empty-state message", () => {
    render(<SavedViewsMenu surfaceKey="test" />);
    fireEvent.click(screen.getByRole("button", { name: /Vues/i }));
    expect(screen.getByText(/Aucune vue enregistrée/i)).toBeInTheDocument();
  });

  it("renders saved views once persisted and applies one on click", () => {
    // Pre-populate localStorage so the hook hydrates with one view.
    window.localStorage.setItem(
      "teranga:saved-views:test",
      JSON.stringify([
        {
          id: "v-1",
          name: "Mon filtre",
          createdAt: "2026-04-01T00:00:00.000Z",
          query: "status=draft",
        },
      ]),
    );
    render(<SavedViewsMenu surfaceKey="test" />);
    fireEvent.click(screen.getByRole("button", { name: /Vues/i }));
    const item = screen.getByRole("button", { name: "Mon filtre" });
    fireEvent.click(item);
    expect(mockRouterPush).toHaveBeenCalledWith("/participants?status=draft");
  });
});
