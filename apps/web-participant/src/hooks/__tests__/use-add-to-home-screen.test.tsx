import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAddToHomeScreen } from "../use-add-to-home-screen";

// ─── useAddToHomeScreen coverage ────────────────────────────────────────────
// Verifies every branch of the `canShow` gate matrix:
//   - Android Chrome, enough visits, never dismissed       ⇒ canShow=true
//   - iOS Safari, enough visits, never dismissed           ⇒ canShow=true
//   - iOS Safari + already PWA (navigator.standalone=true) ⇒ canShow=false,
//                                                           reason=already-pwa
//   - Dismissed 3 times                                    ⇒ canShow=false
//   - Dismissed 1 day ago (< 7 day cooldown)               ⇒ canShow=false
//   - Desktop Firefox                                      ⇒ canShow=false,
//                                                           reason=not-supported

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
const DESKTOP_FIREFOX_UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

function mockStandaloneMedia(match: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(display-mode: standalone)" ? match : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function bumpVisits(n: number) {
  // The hook reads this at mount and adds 1 — so set to (n-1) to simulate
  // a user on their nth visit.
  window.localStorage.setItem("teranga.visits", String(n - 1));
}

describe("useAddToHomeScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    mockStandaloneMedia(false);
    delete (navigator as NavigatorWithStandalone).standalone;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as NavigatorWithStandalone).standalone;
  });

  it("canShow=true on Android Chrome with >=3 visits and no dismissals", async () => {
    setUserAgent(ANDROID_CHROME_UA);
    bumpVisits(3);
    const { result } = renderHook(() => useAddToHomeScreen());
    await waitFor(() => {
      expect(result.current.canShow).toBe(true);
    });
    expect(result.current.isAndroidChrome).toBe(true);
    expect(result.current.reason).toBe("ready");
  });

  it("canShow=true on iOS Safari when not already a PWA", async () => {
    setUserAgent(IOS_SAFARI_UA);
    bumpVisits(3);
    const { result } = renderHook(() => useAddToHomeScreen());
    await waitFor(() => {
      expect(result.current.canShow).toBe(true);
    });
    expect(result.current.isIos).toBe(true);
    expect(result.current.reason).toBe("ready");
  });

  it("canShow=false and reason='already-pwa' when navigator.standalone is true", async () => {
    setUserAgent(IOS_SAFARI_UA);
    bumpVisits(3);
    (navigator as NavigatorWithStandalone).standalone = true;
    const { result } = renderHook(() => useAddToHomeScreen());
    await waitFor(() => {
      expect(result.current.reason).toBe("already-pwa");
    });
    expect(result.current.canShow).toBe(false);
  });

  it("canShow=false after 3 dismissals", async () => {
    setUserAgent(IOS_SAFARI_UA);
    bumpVisits(10);
    window.localStorage.setItem("teranga.a2hs.dismissed", "3");
    // lastDismissedAt far in the past so the cooldown isn't the gate.
    window.localStorage.setItem(
      "teranga.a2hs.lastDismissedAt",
      String(Date.now() - 365 * 24 * 60 * 60 * 1000),
    );
    const { result } = renderHook(() => useAddToHomeScreen());
    await waitFor(() => {
      expect(result.current.reason).toBe("dismissed");
    });
    expect(result.current.canShow).toBe(false);
  });

  it("canShow=false when last dismissal was 1 day ago (within cooldown)", async () => {
    setUserAgent(IOS_SAFARI_UA);
    bumpVisits(5);
    window.localStorage.setItem("teranga.a2hs.dismissed", "1");
    window.localStorage.setItem(
      "teranga.a2hs.lastDismissedAt",
      String(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    );
    const { result } = renderHook(() => useAddToHomeScreen());
    await waitFor(() => {
      expect(result.current.reason).toBe("dismissed");
    });
    expect(result.current.canShow).toBe(false);
  });

  it("canShow=false and reason='too-early' under 3 visits", async () => {
    setUserAgent(IOS_SAFARI_UA);
    // Fresh localStorage means visit count starts at 1 after the mount bump.
    const { result } = renderHook(() => useAddToHomeScreen());
    await waitFor(() => {
      expect(result.current.visitCount).toBe(1);
    });
    expect(result.current.canShow).toBe(false);
    expect(result.current.reason).toBe("too-early");
  });

  it("canShow=false and reason='not-supported' on desktop Firefox", async () => {
    setUserAgent(DESKTOP_FIREFOX_UA);
    bumpVisits(10);
    const { result } = renderHook(() => useAddToHomeScreen());
    await waitFor(() => {
      expect(result.current.reason).toBe("not-supported");
    });
    expect(result.current.canShow).toBe(false);
    expect(result.current.isDesktop).toBe(true);
  });

  it("dismiss() bumps the counter and timestamps lastDismissedAt", async () => {
    setUserAgent(IOS_SAFARI_UA);
    bumpVisits(3);
    const { result } = renderHook(() => useAddToHomeScreen());
    await waitFor(() => {
      expect(result.current.canShow).toBe(true);
    });
    act(() => {
      result.current.dismiss();
    });
    await waitFor(() => {
      expect(result.current.dismissedCount).toBe(1);
    });
    const stamp = Number(window.localStorage.getItem("teranga.a2hs.lastDismissedAt"));
    expect(stamp).toBeGreaterThan(Date.now() - 5_000);
  });

  it("captures beforeinstallprompt and dispatches on trigger()", async () => {
    setUserAgent(ANDROID_CHROME_UA);
    bumpVisits(3);

    // Build a minimal BeforeInstallPromptEvent stub. The `prompt()` +
    // `userChoice` are the critical surface the hook exercises.
    const promptMock = vi.fn().mockResolvedValue(undefined);
    const userChoice = Promise.resolve({ outcome: "accepted" as const, platform: "web" });
    class FakePromptEvent extends Event {
      platforms = ["web"];
      userChoice = userChoice;
      prompt = promptMock;
    }

    const { result } = renderHook(() => useAddToHomeScreen());
    await waitFor(() => {
      expect(result.current.canShow).toBe(true);
    });

    // Fire the synthetic event — the hook listener should capture + preventDefault.
    const ev = new FakePromptEvent("beforeinstallprompt");
    window.dispatchEvent(ev);

    const outcome = await result.current.trigger();
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(outcome).toBe("installed");
  });
});
