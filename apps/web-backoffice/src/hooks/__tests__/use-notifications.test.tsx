import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ─── Phase B.2 — notification preferences hooks coverage ───────────────────
// Pins the per-channel preference contract. Three regressions would hurt:
//
//   1. The PUT payload gets coerced to booleans, dropping per-channel
//      objects. Silently downgrades users who had granular settings.
//   2. A legacy bare-boolean value round-trips through the hook as an
//      object (or vice versa). Shape drift breaks the channel-preferences
//      dispatcher on the server side.
//   3. The catalog query stops invalidating when preferences mutate. The
//      UI's `effectiveChannels` stays stale → the page shows the old
//      toggle state even though the server resolved the new one.
//
// Mutation hooks trigger toasts from `sonner` — we don't assert on those,
// we just stub the module so render doesn't blow up in happy-dom.

const mockUpdatePreferences = vi.fn();
const mockGetPreferences = vi.fn();
const mockGetCatalog = vi.fn();
const mockTestSendSelf = vi.fn();

vi.mock("@/lib/api-client", () => ({
  notificationsApi: {
    updatePreferences: (dto: unknown) => mockUpdatePreferences(dto),
    getPreferences: () => mockGetPreferences(),
    getCatalog: () => mockGetCatalog(),
    testSendSelf: (key: string) => mockTestSendSelf(key),
  },
}));

// Sonner is a side-effect import inside the hooks module. Stub it so we
// can assert the toast calls without actually mounting the Toaster.
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import {
  useUpdateNotificationPreferences,
  useNotificationPreferences,
  useNotificationCatalog,
  useTestSendSelf,
} from "../use-notifications";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useUpdateNotificationPreferences — PUT payload shape", () => {
  it("passes a per-channel byKey object through unchanged (no boolean coercion)", async () => {
    // The Phase B.1 backend accepts `byKey[key]` as EITHER a bare boolean
    // OR a per-channel object. Users who flip one channel but leave the
    // others alone should see their exact input land on the wire — if the
    // hook (or a future refactor) narrows to boolean, the server merges
    // wrong and the user silently loses the other channels.
    mockUpdatePreferences.mockResolvedValue({ success: true, data: {} });

    const { result } = renderHook(() => useUpdateNotificationPreferences(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        byKey: {
          "event.reminder": { email: true, sms: false, push: true, in_app: true },
        },
      });
    });

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      byKey: {
        "event.reminder": { email: true, sms: false, push: true, in_app: true },
      },
    });
  });

  it("preserves a legacy bare-boolean byKey value round-trip", async () => {
    // Pre-Phase-2.6 docs stored `byKey[key] = false` for total opt-out.
    // The hook must pass that shape through verbatim; the server's
    // `isChannelAllowedForUser()` helper still resolves it correctly.
    mockUpdatePreferences.mockResolvedValue({ success: true, data: {} });

    const { result } = renderHook(() => useUpdateNotificationPreferences(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        byKey: { "marketing.newsletter": false },
      });
    });

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      byKey: { "marketing.newsletter": false },
    });
  });

  it("passes top-level channel + quiet-hours fields untouched", async () => {
    // Sanity check: the hook is a thin pass-through. If anyone adds a
    // transform layer later, this test will break before the API does.
    mockUpdatePreferences.mockResolvedValue({ success: true, data: {} });
    const { result } = renderHook(() => useUpdateNotificationPreferences(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        emailTransactional: false,
        emailMarketing: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
      });
    });

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      emailTransactional: false,
      emailMarketing: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
    });
  });

  it("invalidates the catalog query on mutation success (so effectiveChannels refreshes)", async () => {
    // The catalog's `effectiveChannels` is computed server-side by
    // merging admin overrides with the same byKey doc we just wrote.
    // If the cache doesn't drop, the prefs page keeps rendering stale
    // toggles after a successful save.
    mockGetPreferences.mockResolvedValue({
      success: true,
      data: {
        id: "u1",
        userId: "u1",
        email: true,
        sms: true,
        push: true,
        emailTransactional: true,
        emailOrganizational: true,
        emailMarketing: true,
        eventReminders: true,
        quietHoursStart: null,
        quietHoursEnd: null,
        byKey: {},
        updatedAt: new Date().toISOString(),
      },
    });
    mockGetCatalog.mockResolvedValue({ success: true, data: [] });
    mockUpdatePreferences.mockResolvedValue({ success: true, data: {} });

    const { result } = renderHook(
      () => {
        const cat = useNotificationCatalog();
        const prefs = useNotificationPreferences();
        const update = useUpdateNotificationPreferences();
        return { cat, prefs, update };
      },
      { wrapper },
    );

    // Wait for the initial reads so the catalog query is in the cache.
    await waitFor(() => expect(result.current.cat.data).toBeDefined());
    expect(mockGetCatalog).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.update.mutateAsync({ byKey: { "event.reminder": true } });
    });

    // Post-mutation, the catalog query should refetch (invalidation fires
    // a new query-function call under the same key).
    await waitFor(() => expect(mockGetCatalog).toHaveBeenCalledTimes(2));
  });
});

describe("useTestSendSelf — error → toast mapping", () => {
  it("shows the generic success toast when the server accepts", async () => {
    mockTestSendSelf.mockResolvedValue({
      success: true,
      data: { dispatched: true, key: "event.reminder", locale: "fr" },
    });

    const { result } = renderHook(() => useTestSendSelf(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("event.reminder");
    });

    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("maps HTTP 429 to the rate-limit message (5/h)", async () => {
    // The route in-memory-rate-limits at 5/h/user. UI must show targeted
    // copy so users know to wait rather than guessing why the test
    // didn't arrive.
    mockTestSendSelf.mockRejectedValue({
      status: 429,
      code: "RATE_LIMITED",
      message: "Too many test sends.",
    });

    const { result } = renderHook(() => useTestSendSelf(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("event.reminder").catch(() => {});
    });

    expect(mockToastError).toHaveBeenCalledTimes(1);
    const firstCall = mockToastError.mock.calls[0]?.[0] as string;
    expect(firstCall).toMatch(/limite|5\/heure/i);
  });

  it("maps NOT_OPTABLE (mandatory key) to the distinct mandatory message", async () => {
    // The server guards `POST /v1/notifications/test-send` against keys
    // with `userOptOutAllowed=false` even though the UI disables the
    // button — defense-in-depth. A NOT_OPTABLE leakage here should read
    // as "mandatory" not "generic failure".
    mockTestSendSelf.mockRejectedValue({
      status: 400,
      code: "NOT_OPTABLE",
      message: "This notification is mandatory.",
    });

    const { result } = renderHook(() => useTestSendSelf(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("auth.password_reset").catch(() => {});
    });

    expect(mockToastError).toHaveBeenCalledTimes(1);
    const firstCall = mockToastError.mock.calls[0]?.[0] as string;
    expect(firstCall).toMatch(/obligatoire/i);
  });
});
