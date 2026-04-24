import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import frMessages from "@/i18n/messages/fr.json";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {children}
    </NextIntlClientProvider>
  );
}

/**
 * T5.3 — `SavedViewsBar` contract tests.
 *
 * Focus:
 *   - Empty state (no chips, no crash when nothing to save).
 *   - "Save this view" prompt → Enter submits, Esc cancels.
 *   - Chip click applies the view (router.push).
 *   - Active view highlighted via aria-pressed.
 *   - Remove button deletes without applying.
 */

let __qs = new URLSearchParams();
const pushSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy }),
  useSearchParams: () => ({
    toString: () => __qs.toString(),
    get: (k: string) => __qs.get(k),
  }),
  usePathname: () => "/admin/users",
}));

import { SavedViewsBar } from "../saved-views-bar";

beforeEach(() => {
  localStorage.clear();
  pushSpy.mockClear();
  __qs = new URLSearchParams();
});

describe("SavedViewsBar — empty state", () => {
  it("renders nothing when there are no views and no query to save", () => {
    const { container } = render(<SavedViewsBar surfaceKey="t-users" />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the 'Save this view' pill when there's a query but no saved view yet", () => {
    __qs = new URLSearchParams("a=1");
    render(<SavedViewsBar surfaceKey="t-users" />, { wrapper });
    expect(screen.getByRole("button", { name: /Sauvegarder cette vue/i })).toBeInTheDocument();
  });
});

describe("SavedViewsBar — save flow", () => {
  it("Enter submits a named view and clears the prompt", async () => {
    __qs = new URLSearchParams("status=past_due");
    render(<SavedViewsBar surfaceKey="t-users" />, { wrapper });

    await userEvent.click(screen.getByRole("button", { name: /Sauvegarder cette vue/i }));
    const input = await screen.findByRole("textbox", {
      name: /Nom de la nouvelle vue/i,
    });
    await userEvent.type(input, "Impayés{Enter}");

    // Chip appears with the saved name.
    expect(
      screen.getByRole("button", { name: /Appliquer la vue « Impayés »/i }),
    ).toBeInTheDocument();
  });

  it("Esc cancels the save prompt without writing to localStorage", async () => {
    __qs = new URLSearchParams("a=1");
    render(<SavedViewsBar surfaceKey="t-users" />, { wrapper });

    await userEvent.click(screen.getByRole("button", { name: /Sauvegarder cette vue/i }));
    const input = await screen.findByRole("textbox", {
      name: /Nom de la nouvelle vue/i,
    });
    await userEvent.type(input, "Typing");
    await userEvent.keyboard("{Escape}");

    // Input gone; no chip for the not-saved view.
    expect(
      screen.queryByRole("textbox", { name: /Nom de la nouvelle vue/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Appliquer la vue « Typing »/i }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem("teranga:saved-views:t-users")).toBeNull();
  });
});

describe("SavedViewsBar — apply + remove", () => {
  it("clicking a chip calls router.push with the saved query", async () => {
    // Pre-seed storage so the hook hydrates with a view.
    localStorage.setItem(
      "teranga:saved-views:t-users",
      JSON.stringify([
        {
          id: "v1",
          name: "Past due",
          createdAt: "2026-04-20T00:00:00Z",
          query: "status=past_due",
        },
      ]),
    );

    __qs = new URLSearchParams();
    render(<SavedViewsBar surfaceKey="t-users" />, { wrapper });

    await userEvent.click(screen.getByRole("button", { name: /Appliquer la vue « Past due »/i }));
    expect(pushSpy).toHaveBeenCalledWith("/admin/users?status=past_due");
  });

  it("clicking the X removes the view without calling router.push", async () => {
    localStorage.setItem(
      "teranga:saved-views:t-users",
      JSON.stringify([
        {
          id: "v1",
          name: "Past due",
          createdAt: "2026-04-20T00:00:00Z",
          query: "status=past_due",
        },
      ]),
    );

    render(<SavedViewsBar surfaceKey="t-users" />, { wrapper });

    await userEvent.click(screen.getByRole("button", { name: /Supprimer la vue « Past due »/i }));
    expect(pushSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /Appliquer la vue « Past due »/i }),
    ).not.toBeInTheDocument();
  });
});

describe("SavedViewsBar — active view", () => {
  it("highlights the chip whose query matches the current URL (aria-pressed)", () => {
    localStorage.setItem(
      "teranga:saved-views:t-users",
      JSON.stringify([
        {
          id: "v1",
          name: "Current",
          createdAt: "2026-04-20T00:00:00Z",
          query: "a=1&b=2",
        },
      ]),
    );
    __qs = new URLSearchParams("a=1&b=2");

    render(<SavedViewsBar surfaceKey="t-users" />, { wrapper });
    const chip = screen.getByRole("button", { name: /Appliquer la vue « Current »/i });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });
});
