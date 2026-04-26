import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// ─── useOrganizerInbox — fetch + refetch contract ────────────────────────────
//
// The hook drives the /inbox landing. We pin three behaviours:
//   1. Initial fetch on mount hydrates `signals` + `lastUpdate`.
//   2. Transport errors land on `error`, leaving `signals` null.
//   3. Manual `refetch()` re-fires the fetch on demand.
//
// The auto-refresh ticking + exponential backoff are NOT exercised
// here because mixing vitest's fake timers with `waitFor` (which
// uses real timers internally) is fragile. The manual refetch path
// shares the same `fetchSignals` callback, so the contract is
// covered transitively. A future integration test can mount the
// /inbox page and assert the visibility-aware tick fires through a
// jsdom event.

const mockApiGet = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: {
    get: (path: string) => mockApiGet(path),
  },
}));

import { useOrganizerInbox } from "../use-organizer-inbox";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useOrganizerInbox — initial fetch", () => {
  it("hydrates signals from /v1/me/inbox on mount", async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        signals: [
          {
            id: "payments.failed_7d",
            category: "urgent",
            severity: "critical",
            title: "2 paiements échoués cette semaine",
            description: "...",
            count: 2,
            href: "/finance?status=failed",
          },
        ],
        computedAt: "2026-04-26T10:00:00.000Z",
      },
    });

    const { result } = renderHook(() => useOrganizerInbox());

    expect(result.current.signals).toBeNull(); // not yet hydrated
    await waitFor(() => expect(result.current.signals).not.toBeNull());

    expect(result.current.signals).toHaveLength(1);
    expect(result.current.signals?.[0].id).toBe("payments.failed_7d");
    expect(result.current.lastUpdate).toBe("2026-04-26T10:00:00.000Z");
    expect(result.current.error).toBeNull();
    expect(mockApiGet).toHaveBeenCalledWith("/v1/me/inbox");
  });

  it("captures a transport error message and leaves signals null", async () => {
    mockApiGet.mockRejectedValue(new Error("Network down"));

    const { result } = renderHook(() => useOrganizerInbox());

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.signals).toBeNull();
    expect(result.current.error).toBe("Network down");
  });

  it("toggles `refreshing` to true during the fetch and back to false on resolve", async () => {
    let resolveFetch!: (value: unknown) => void;
    mockApiGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result } = renderHook(() => useOrganizerInbox());

    // The hook flips refreshing=true synchronously inside fetchSignals
    // before awaiting. Wait for that micro-task.
    await waitFor(() => expect(result.current.refreshing).toBe(true));

    act(() => {
      resolveFetch({
        success: true,
        data: { signals: [], computedAt: "2026-04-26T10:00:00.000Z" },
      });
    });

    await waitFor(() => expect(result.current.refreshing).toBe(false));
  });
});

describe("useOrganizerInbox — refetch on demand", () => {
  it("re-fires the fetch when `refetch()` is invoked", async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: { signals: [], computedAt: "2026-04-26T10:00:00.000Z" },
    });

    const { result } = renderHook(() => useOrganizerInbox());
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));
  });

  it("clears a previous error when a manual refetch succeeds", async () => {
    mockApiGet.mockRejectedValueOnce(new Error("First-call boom")).mockResolvedValue({
      success: true,
      data: { signals: [], computedAt: "2026-04-26T11:00:00.000Z" },
    });

    const { result } = renderHook(() => useOrganizerInbox());
    await waitFor(() => expect(result.current.error).toBe("First-call boom"));

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.signals).toEqual([]);
    expect(result.current.lastUpdate).toBe("2026-04-26T11:00:00.000Z");
  });
});
