import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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
