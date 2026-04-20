import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePlanGating } from "../use-plan-gating";

// ─── usePlanGating hook coverage ───────────────────────────────────────────
// This hook is the client-side gate for the entire freemium paywall.
// Any regression here either (a) silently exposes paid features to free
// orgs (revenue leak) or (b) blocks legitimate access (churn). Pin it.
//
// Upstream deps mocked at the module boundary so the hook runs
// against deterministic inputs:
//   - useAuth            → controls orgId + roles
//   - useOrganization    → controls plan + effective features/limits
//   - organizationsApi   → controls usage response (events / members)
//
// The `getEffectiveFeatures` / `getEffectiveLimits` helpers in
// `use-plans-catalog` stay real — they're the code we actually want
// to exercise. When the org lacks Phase 2 denormalised fields, they
// fall back to the legacy `PLAN_LIMITS` table; that fallback is part
// of the behaviour we're pinning.

const mockUseAuth = vi.fn();
const mockUseOrganization = vi.fn();
const mockGetUsage = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/hooks/use-organization", () => ({
  useOrganization: () => mockUseOrganization(),
}));

vi.mock("@/lib/api-client", () => ({
  organizationsApi: {
    getUsage: (...args: unknown[]) => mockGetUsage(...args),
  },
}));

// ─── Harness ────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  // Each test gets a fresh QueryClient so cached queries don't bleed.
  // `retry: false` → failing queries surface immediately instead of
  // burning the test timeout on backoff.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("usePlanGating — plan + feature gate", () => {
  it("defaults to `free` plan when the org is missing", () => {
    mockUseAuth.mockReturnValue({ user: null });
    mockUseOrganization.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => usePlanGating(), { wrapper });
    expect(result.current.plan).toBe("free");
    // Free plan has no premium features enabled.
    expect(result.current.canUse("qrScanning")).toBe(false);
    expect(result.current.canUse("advancedAnalytics")).toBe(false);
  });

  it("pro plan enables qrScanning and advancedAnalytics (paywall floor)", () => {
    mockUseAuth.mockReturnValue({ user: { uid: "u-1", organizationId: "org-1" } });
    mockUseOrganization.mockReturnValue({
      data: { data: { id: "org-1", plan: "pro" } },
    });

    const { result } = renderHook(() => usePlanGating(), { wrapper });
    expect(result.current.plan).toBe("pro");
    expect(result.current.canUse("qrScanning")).toBe(true);
    expect(result.current.canUse("advancedAnalytics")).toBe(true);
    // Enterprise-only features stay gated at pro.
    expect(result.current.canUse("whiteLabel")).toBe(false);
    expect(result.current.canUse("apiAccess")).toBe(false);
  });

  it("honours effectiveFeatures override over the legacy plan fallback", () => {
    // Phase 2 denormalization: `effectiveFeatures` on the org doc is the
    // authoritative snapshot (handles per-org overrides). A free-plan org
    // with a hand-tuned `effectiveFeatures` should unlock accordingly —
    // the gate must read from effectiveFeatures, not just `plan`.
    mockUseAuth.mockReturnValue({ user: { uid: "u-1", organizationId: "org-1" } });
    mockUseOrganization.mockReturnValue({
      data: {
        data: {
          id: "org-1",
          plan: "free",
          effectiveFeatures: {
            qrScanning: true,
            paidTickets: false,
            customBadges: false,
            csvExport: false,
            smsNotifications: false,
            advancedAnalytics: false,
            speakerPortal: false,
            sponsorPortal: false,
            apiAccess: false,
            whiteLabel: false,
            promoCodes: false,
          },
        },
      },
    });

    const { result } = renderHook(() => usePlanGating(), { wrapper });
    // plan stays `"free"` — this is a per-org override, not a plan change.
    expect(result.current.plan).toBe("free");
    expect(result.current.canUse("qrScanning")).toBe(true);
    expect(result.current.canUse("paidTickets")).toBe(false);
  });
});

describe("usePlanGating — checkLimit + isNearLimit", () => {
  it("returns zero-current allowed when usage hasn't loaded yet", () => {
    // Pre-fetch state: the hook still has to answer `checkLimit` for
    // render-blocking UI (sidebar meters, create buttons). The contract
    // is "assume not-over-limit with current=0" until the fetch lands.
    mockUseAuth.mockReturnValue({ user: { uid: "u-1", organizationId: "org-1" } });
    mockUseOrganization.mockReturnValue({
      data: { data: { id: "org-1", plan: "starter" } },
    });
    // getUsage returns a never-resolving promise → `usage` stays undefined.
    mockGetUsage.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePlanGating(), { wrapper });
    const limit = result.current.checkLimit("events");
    expect(limit.current).toBe(0);
    expect(limit.allowed).toBe(true);
    expect(limit.percent).toBe(0);
    // Starter plan has a 10-event limit per `PLAN_LIMITS` fallback.
    expect(limit.limit).toBe(10);
  });

  it("computes percent + allowed from the usage response", async () => {
    mockUseAuth.mockReturnValue({ user: { uid: "u-1", organizationId: "org-1" } });
    mockUseOrganization.mockReturnValue({
      data: { data: { id: "org-1", plan: "starter" } },
    });
    mockGetUsage.mockResolvedValue({
      data: {
        events: { current: 8, limit: 10 },
        members: { current: 2, limit: 3 },
      },
    });

    const { result } = renderHook(() => usePlanGating(), { wrapper });
    await waitFor(() => {
      expect(result.current.usage).toBeDefined();
    });

    const events = result.current.checkLimit("events");
    expect(events.current).toBe(8);
    expect(events.limit).toBe(10);
    expect(events.percent).toBe(80);
    expect(events.allowed).toBe(true);

    const members = result.current.checkLimit("members");
    expect(members.current).toBe(2);
    expect(members.limit).toBe(3);
    expect(members.percent).toBe(67); // round(2/3 * 100)
    expect(members.allowed).toBe(true);
  });

  it("denies creation when current >= limit", async () => {
    mockUseAuth.mockReturnValue({ user: { uid: "u-1", organizationId: "org-1" } });
    mockUseOrganization.mockReturnValue({
      data: { data: { id: "org-1", plan: "starter" } },
    });
    mockGetUsage.mockResolvedValue({
      data: {
        events: { current: 10, limit: 10 }, // at cap
        members: { current: 3, limit: 3 },
      },
    });

    const { result } = renderHook(() => usePlanGating(), { wrapper });
    await waitFor(() => {
      expect(result.current.usage).toBeDefined();
    });

    expect(result.current.checkLimit("events").allowed).toBe(false);
    expect(result.current.checkLimit("events").percent).toBe(100);
  });

  it("flags near-limit at 80% (sidebar upgrade nudge)", async () => {
    mockUseAuth.mockReturnValue({ user: { uid: "u-1", organizationId: "org-1" } });
    mockUseOrganization.mockReturnValue({
      data: { data: { id: "org-1", plan: "starter" } },
    });
    mockGetUsage.mockResolvedValue({
      data: {
        events: { current: 8, limit: 10 }, // 80% exact
        members: { current: 1, limit: 3 }, // 33%
      },
    });

    const { result } = renderHook(() => usePlanGating(), { wrapper });
    await waitFor(() => {
      expect(result.current.usage).toBeDefined();
    });

    expect(result.current.isNearLimit("events")).toBe(true);
    expect(result.current.isNearLimit("members")).toBe(false);
  });

  it("treats Infinity limit as never-over (enterprise plan)", async () => {
    mockUseAuth.mockReturnValue({ user: { uid: "u-1", organizationId: "org-1" } });
    mockUseOrganization.mockReturnValue({
      data: { data: { id: "org-1", plan: "enterprise" } },
    });
    mockGetUsage.mockResolvedValue({
      data: {
        events: { current: 9999, limit: Infinity },
        members: { current: 500, limit: Infinity },
      },
    });

    const { result } = renderHook(() => usePlanGating(), { wrapper });
    await waitFor(() => {
      expect(result.current.usage).toBeDefined();
    });

    const events = result.current.checkLimit("events");
    expect(events.allowed).toBe(true);
    expect(events.percent).toBe(0); // never render a meaningful percent
    expect(result.current.isNearLimit("events")).toBe(false);
  });
});

describe("usePlanGating — query enablement", () => {
  it("does not fire the usage query when the user has no org", () => {
    mockUseAuth.mockReturnValue({ user: null });
    mockUseOrganization.mockReturnValue({ data: undefined });

    renderHook(() => usePlanGating(), { wrapper });
    expect(mockGetUsage).not.toHaveBeenCalled();
  });

  it("fires the usage query once an orgId is present", async () => {
    mockUseAuth.mockReturnValue({ user: { uid: "u-1", organizationId: "org-42" } });
    mockUseOrganization.mockReturnValue({
      data: { data: { id: "org-42", plan: "starter" } },
    });
    mockGetUsage.mockResolvedValue({
      data: { events: { current: 1, limit: 10 }, members: { current: 1, limit: 3 } },
    });

    renderHook(() => usePlanGating(), { wrapper });
    await waitFor(() => {
      expect(mockGetUsage).toHaveBeenCalledWith("org-42");
    });
  });
});
