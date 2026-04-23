import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useIsPwa } from "../use-is-pwa";

// ─── useIsPwa coverage ──────────────────────────────────────────────────────
// Exercises every detection branch:
//   1. matchMedia(display-mode: standalone) → true  ⇒ true
//   2. navigator.standalone (iOS) → true            ⇒ true
//   3. URL ?source=pwa                              ⇒ true
//   4. None of the above                            ⇒ false
//   5. SSR-safe — first return value is `null`
//
// All DOM-level globals are mocked on `window` / `navigator` directly
// rather than via jsdom config so each case is self-contained.

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function mockMatchMedia(result: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(display-mode: standalone)" ? result : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("useIsPwa", () => {
  beforeEach(() => {
    // Reset between tests so leaked flags can't cross-contaminate.
    window.sessionStorage.clear();
    mockMatchMedia(false);
    // Scrub iOS standalone flag.
    delete (navigator as NavigatorWithStandalone).standalone;
    // Reset URL — happy-dom doesn't always wipe between tests.
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    delete (navigator as NavigatorWithStandalone).standalone;
    vi.restoreAllMocks();
  });

  it("returns true when matchMedia display-mode standalone matches", async () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsPwa());
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it("returns true when iOS navigator.standalone is true", async () => {
    (navigator as NavigatorWithStandalone).standalone = true;
    const { result } = renderHook(() => useIsPwa());
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it("returns true when URL carries ?source=pwa", async () => {
    window.history.replaceState(null, "", "/?source=pwa");
    const { result } = renderHook(() => useIsPwa());
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it("returns false when no signal is present", async () => {
    const { result } = renderHook(() => useIsPwa());
    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it("mirrors the ?source=pwa hit into sessionStorage for the next navigation", async () => {
    window.history.replaceState(null, "", "/?source=pwa");
    const { result } = renderHook(() => useIsPwa());
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    expect(window.sessionStorage.getItem("teranga.isPwa")).toBe("true");
  });

  it("still reports PWA on subsequent mount when sessionStorage carries the flag", async () => {
    window.sessionStorage.setItem("teranga.isPwa", "true");
    const { result } = renderHook(() => useIsPwa());
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it("returns null synchronously before the first effect run (SSR-safe)", () => {
    // We capture the value from the *first* render of the hook, before any
    // effect has committed — that's the value the server would serialize
    // and the client hydrates against.
    const seen: Array<boolean | null> = [];
    renderHook(() => {
      const v = useIsPwa();
      seen.push(v);
      return v;
    });
    // First render (synchronous) must not commit to a boolean, or the
    // hydrated HTML would diverge from the server. Committed boolean
    // follows on a later render.
    expect(seen[0]).toBeNull();
    // Allow any pending effects to settle so React doesn't warn.
    act(() => undefined);
  });
});
