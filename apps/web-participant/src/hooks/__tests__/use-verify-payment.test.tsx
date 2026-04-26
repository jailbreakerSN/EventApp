import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useVerifyPayment } from "../use-payments";

// ─── ADR-0018 — useVerifyPayment hook contract ─────────────────────────────
// Pins the React-Query mutation contract so a future refactor of the
// hook can't silently break the cache-invalidation behaviour the
// /payment-status page relies on.
//
// The mutation MUST invalidate three query keys on success so the
// polling hook + my-events list + per-event lookup all re-fetch the
// finalised state without waiting for their next stale tick:
//   - ["payment-status", paymentId]
//   - ["my-registrations"]
//   - ["my-registration-for-event"]

const { mockVerify } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  paymentsApi: { verify: (id: string) => mockVerify(id) },
  promoCodesApi: { validate: vi.fn() },
}));

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  mockVerify.mockReset();
});

describe("useVerifyPayment", () => {
  it("starts idle (isPending=false, data=undefined)", () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useVerifyPayment(), { wrapper: makeWrapper(client) });
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("on success — invalidates payment-status + my-registrations + my-registration-for-event", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    mockVerify.mockResolvedValueOnce({
      success: true,
      data: { paymentId: "pay-1", status: "succeeded", outcome: "succeeded" },
    });

    const { result } = renderHook(() => useVerifyPayment(), { wrapper: makeWrapper(client) });
    result.current.mutate("pay-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockVerify).toHaveBeenCalledWith("pay-1");
    // The 3 cache invalidations the page relies on
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["payment-status", "pay-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["my-registrations"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["my-registration-for-event"] });
  });

  it("on outcome=pending — still resolves successfully (caller falls back to polling)", async () => {
    // Pending is NOT an error — the API call succeeded, the provider
    // hasn't finalised. The hook resolves normally; the page reads
    // `outcome` and decides to keep polling.
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    mockVerify.mockResolvedValueOnce({
      success: true,
      data: { paymentId: "pay-2", status: "processing", outcome: "pending" },
    });

    const { result } = renderHook(() => useVerifyPayment(), { wrapper: makeWrapper(client) });
    result.current.mutate("pay-2");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data as { data?: { outcome?: string } } | undefined;
    expect(data?.data?.outcome).toBe("pending");
  });

  it("on API error — resolves to error state (caller falls back to polling)", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    mockVerify.mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() => useVerifyPayment(), { wrapper: makeWrapper(client) });
    result.current.mutate("pay-3");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
