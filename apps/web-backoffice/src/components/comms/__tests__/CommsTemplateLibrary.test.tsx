import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { SEED_COMMS_TEMPLATES } from "@teranga/shared-types";

// Stub the network layer of the hook by mocking the api client. The
// React Query wrapper handles the rest.
const mockApiGet = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: {
    get: (path: string) => mockApiGet(path),
  },
}));

import { CommsTemplateLibrary } from "../CommsTemplateLibrary";

beforeEach(() => {
  vi.clearAllMocks();
});

// Renders the library with both a QueryClient and the nuqs testing
// adapter so `useQueryStates` resolves without a Next.js router. The
// `searchParams` arg seeds the initial URL state — used to assert that
// a deep link to `?library.q=foo&library.cat=reminder` lands on the
// pre-filtered view.
function renderWithClient(
  ui: React.ReactElement,
  searchParams: Record<string, string> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={searchParams}>{ui}</NuqsTestingAdapter>
    </QueryClientProvider>,
  );
}

describe("CommsTemplateLibrary — category tabs + cards", () => {
  it("renders one card per template returned by the hook", async () => {
    mockApiGet.mockResolvedValue({ success: true, data: SEED_COMMS_TEMPLATES });
    renderWithClient(<CommsTemplateLibrary />);

    // 12 templates → 12 "Utiliser ce modèle" CTA buttons (when onPick
    // is omitted it defaults to absent — the test-render below covers
    // that path explicitly).
    const cards = await screen.findAllByText(/Rappel J-7/);
    expect(cards.length).toBeGreaterThan(0);
  });

  it("invokes `onPick` with the template when the CTA is clicked", async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: [SEED_COMMS_TEMPLATES[0]], // just the J-7 reminder
    });
    const onPick = vi.fn();
    renderWithClient(<CommsTemplateLibrary onPick={onPick} />);

    const cta = await screen.findByRole("button", { name: /Utiliser ce modèle/i });
    fireEvent.click(cta);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].id).toBe("reminder-j7");
  });

  it("switches the category tab and re-fires the request with ?category=…", async () => {
    mockApiGet
      .mockResolvedValueOnce({ success: true, data: SEED_COMMS_TEMPLATES })
      .mockResolvedValueOnce({
        success: true,
        data: SEED_COMMS_TEMPLATES.filter((t) => t.category === "reminder"),
      });
    renderWithClient(<CommsTemplateLibrary />);

    await screen.findByText(/Rappel J-7/);
    const remindersTab = screen.getByRole("tab", { name: "Rappels" });
    fireEvent.click(remindersTab);

    // Wait for the second call.
    await screen.findByText(/Rappel J-7/); // still rendered after re-fetch
    const lastCall = mockApiGet.mock.calls[mockApiGet.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain("category=reminder");
  });

  it("renders an empty state when the API returns zero templates", async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    renderWithClient(<CommsTemplateLibrary />);
    expect(
      await screen.findByText(/Aucun template dans cette catégorie pour le moment/),
    ).toBeInTheDocument();
  });
});

// ─── W4 doctrine top-up — search + URL state ───────────────────────────────
//
// Library-tab search is debounced 300 ms, accent-folded, and persisted
// in the URL via nuqs under the `library` namespace. These tests pin
// the contract: deep links survive refresh, "Sénégal" matches "senegal",
// and the search-empty state distinguishes itself from the
// category-empty state with a "clear search" CTA.

describe("CommsTemplateLibrary — search + URL state (W4 doctrine)", () => {
  it("hydrates from ?library.q=… and shows only matching templates", async () => {
    mockApiGet.mockResolvedValue({ success: true, data: SEED_COMMS_TEMPLATES });
    renderWithClient(<CommsTemplateLibrary />, { "library.q": "j-7" });

    // The seeded "Rappel J-7" template matches; the "Confirmation
    // d'inscription" et al. should NOT render.
    await waitFor(() => expect(screen.getByText(/Rappel J-7/)).toBeInTheDocument());
    expect(screen.queryByText(/Confirmation d.inscription/)).not.toBeInTheDocument();
  });

  it("hydrates from ?library.cat=… and re-fires the request scoped to that category", async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: SEED_COMMS_TEMPLATES.filter((t) => t.category === "reminder"),
    });
    renderWithClient(<CommsTemplateLibrary />, { "library.cat": "reminder" });

    await screen.findByText(/Rappel J-7/);
    const lastCall = mockApiGet.mock.calls[mockApiGet.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain("category=reminder");
    // The "Rappels" tab should have aria-selected=true on hydration —
    // proves the URL state seeded the controlled state correctly.
    const remindersTab = screen.getByRole("tab", { name: "Rappels" });
    expect(remindersTab).toHaveAttribute("aria-selected", "true");
  });

  it("matches accent-folded text (Sénégal-style normalisation)", async () => {
    // Seed the response with one ASCII-only template that should match
    // an accented query. The seed catalogue itself is ASCII-only so we
    // synthesise a template containing accents to drive the inverse
    // direction too.
    const accented = {
      ...SEED_COMMS_TEMPLATES[0],
      id: "tplFR-1",
      label: "Préparez votre événement",
      description: "Astuces pour réussir l'événement",
      title: "Préparation de l'événement",
      body: "Voici comment préparer votre Sénégal Conference",
    };
    mockApiGet.mockResolvedValue({ success: true, data: [accented] });
    // Query "senegal" (no accent) MUST match "Sénégal" (accented body).
    renderWithClient(<CommsTemplateLibrary />, { "library.q": "senegal" });

    await waitFor(() =>
      expect(screen.getByText(/Préparez votre événement/)).toBeInTheDocument(),
    );
  });

  it("renders the search-empty state (distinct from category-empty) when q has no match", async () => {
    mockApiGet.mockResolvedValue({ success: true, data: SEED_COMMS_TEMPLATES });
    renderWithClient(<CommsTemplateLibrary />, { "library.q": "zzzimpossible" });

    // The empty-state copy should mention the query verbatim AND offer
    // an "Effacer la recherche" CTA (the doctrine-mandated distinction
    // from the "no templates in category" branch).
    await waitFor(() =>
      expect(screen.getByText(/Aucun modèle ne correspond/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/zzzimpossible/)).toBeInTheDocument();
    // The empty-state CTA clears BOTH q + cat, so its label is
    // "Réinitialiser les filtres" — distinct from the search-input
    // X button ("Effacer la recherche") which only clears q.
    expect(
      screen.getByRole("button", { name: /Réinitialiser les filtres/ }),
    ).toBeInTheDocument();
  });

  it("exposes a clear-X icon button on the search input when q is non-empty", async () => {
    mockApiGet.mockResolvedValue({ success: true, data: SEED_COMMS_TEMPLATES });
    renderWithClient(<CommsTemplateLibrary />, { "library.q": "rappel" });

    await screen.findByText(/Rappel J-7/);
    expect(
      screen.getByRole("button", { name: /Effacer la recherche/ }),
    ).toBeInTheDocument();
  });
});
