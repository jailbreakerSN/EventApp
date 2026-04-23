import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ─── Phase D.3 — admin delivery-dashboard hook coverage ──────────────────
// Pins the contract for the super-admin delivery observability hook.
// Three regressions would hurt:
//
//   1. Happy path stops handing the decoded `data` shape to the caller.
//      The chart components read `data.data.totals`/`timeseries` directly;
//      a shape drift silently breaks the dashboard.
//   2. The 400 "window too large" response is retried instead of failing
//      fast. React Query's default retry (3) would compound the 10k-row
//      Firestore scan into 30k reads — the very scenario the server-side
//      cap was designed to block.
//   3. The 429 rate-limit response is retried. Same cost problem, plus
//      the UI surfaces a retry loop instead of the Retry-After hint.

const mockDelivery = vi.fn();

vi.mock("@/lib/api-client", () => ({
  adminNotificationsApi: {
    delivery: (params: unknown) => mockDelivery(params),
  },
}));

import { useAdminDeliveryDashboard } from "../use-admin-notifications";

function wrapper({ children }: { children: ReactNode }) {
  // Fresh QueryClient per test — prevents cache carryover from leaking
  // between "429 on first call" and "200 on a subsequent call" cases.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAdminDeliveryDashboard — happy path", () => {
  it("returns the API envelope unchanged on a 200 response", async () => {
    const payload = {
      success: true,
      data: {
        range: {
          from: "2026-04-16T00:00:00.000Z",
          to: "2026-04-23T00:00:00.000Z",
          granularity: "day" as const,
        },
        totals: {
          sent: 10,
          delivered: 8,
          opened: 5,
          clicked: 2,
          pushDisplayed: 1,
          pushClicked: 0,
          suppressed: {
            admin_disabled: 0,
            user_opted_out: 1,
            on_suppression_list: 0,
            no_recipient: 0,
            rate_limited: 0,
            deduplicated: 0,
            bounced: 1,
            complained: 0,
          },
        },
        timeseries: [],
        perChannel: [],
      },
    };
    mockDelivery.mockResolvedValue(payload);

    const { result } = renderHook(
      () =>
        useAdminDeliveryDashboard({
          from: "2026-04-16T00:00:00.000Z",
          to: "2026-04-23T00:00:00.000Z",
          granularity: "day",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(mockDelivery).toHaveBeenCalledWith({
      from: "2026-04-16T00:00:00.000Z",
      to: "2026-04-23T00:00:00.000Z",
      granularity: "day",
    });
  });
});

describe("useAdminDeliveryDashboard — error paths", () => {
  it("does NOT retry on a 400 window-too-large response", async () => {
    const err = Object.assign(new Error("Window too large"), {
      status: 400,
      code: "WINDOW_TOO_LARGE",
    });
    mockDelivery.mockRejectedValue(err);

    const { result } = renderHook(() => useAdminDeliveryDashboard({}), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Exactly one call — the hook's retry predicate returns false for 400.
    expect(mockDelivery).toHaveBeenCalledTimes(1);
    expect((result.current.error as { code?: string }).code).toBe(
      "WINDOW_TOO_LARGE",
    );
  });

  it("does NOT retry on a 429 rate-limited response", async () => {
    const err = Object.assign(new Error("Rate limited"), {
      status: 429,
      code: "RATE_LIMITED",
    });
    mockDelivery.mockRejectedValue(err);

    const { result } = renderHook(() => useAdminDeliveryDashboard({}), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockDelivery).toHaveBeenCalledTimes(1);
    expect((result.current.error as { code?: string }).code).toBe("RATE_LIMITED");
  });
});
