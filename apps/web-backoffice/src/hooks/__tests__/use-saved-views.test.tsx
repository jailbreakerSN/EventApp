import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSavedViews } from "../use-saved-views";

/**
 * T5.3 — hook contract for localStorage-backed saved views.
 *
 * Router dependency is stubbed globally in vitest.setup.ts. The hook
 * reads `searchParams` + `pathname`, both mocked to return stable
 * values here so we can exercise the serialize / restore / dedup /
 * cap paths without a real Next.js router.
 */

// Mock next/navigation — the hook reads useRouter / useSearchParams.
// We keep the mock simple: `push` is a spy, searchParams reflects a
// query string we set per-test via the module-level `__qs` holder.
let __qs = new URLSearchParams();
const pushSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy }),
  useSearchParams: () => ({
    toString: () => __qs.toString(),
    get: (k: string) => __qs.get(k),
  }),
  usePathname: () => "/admin/audit",
}));

const SURFACE = "test-saved-views";

beforeEach(() => {
  localStorage.clear();
  pushSpy.mockClear();
  __qs = new URLSearchParams();
});

describe("useSavedViews", () => {
  it("starts empty and hydrates from localStorage on mount", () => {
    const { result } = renderHook(() => useSavedViews(SURFACE));
    expect(result.current.views).toEqual([]);
    expect(result.current.activeViewId).toBeNull();
  });

  it("save() writes a view to localStorage and surfaces it in the list", () => {
    __qs = new URLSearchParams("action=event.created&limit=50");
    const { result } = renderHook(() => useSavedViews(SURFACE));

    act(() => result.current.save("Paiements échoués"));

    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0]?.name).toBe("Paiements échoués");
    expect(result.current.views[0]?.query).toBe("action=event.created&limit=50");

    // Persisted across re-mount.
    const second = renderHook(() => useSavedViews(SURFACE));
    expect(second.result.current.views).toHaveLength(1);
  });

  it("dedupes by name (case-insensitive) — overwriting the query", () => {
    __qs = new URLSearchParams("a=1");
    const { result } = renderHook(() => useSavedViews(SURFACE));
    act(() => result.current.save("My View"));

    __qs = new URLSearchParams("b=2");
    const { result: result2 } = renderHook(() => useSavedViews(SURFACE));
    act(() => result2.current.save("my view")); // lowercase dup

    expect(result2.current.views).toHaveLength(1);
    expect(result2.current.views[0]?.name).toBe("my view"); // latest wins
    expect(result2.current.views[0]?.query).toBe("b=2");
  });

  it("caps the list at 10 entries per surface (industry cap)", () => {
    const { result } = renderHook(() => useSavedViews(SURFACE));
    for (let i = 0; i < 15; i++) {
      __qs = new URLSearchParams(`page=${i}`);
      act(() => result.current.save(`View ${i}`));
    }
    expect(result.current.views).toHaveLength(10);
    // Newest-first — "View 14" is at the head.
    expect(result.current.views[0]?.name).toBe("View 14");
  });

  it("remove() drops a view and persists the deletion", () => {
    __qs = new URLSearchParams("a=1");
    const { result } = renderHook(() => useSavedViews(SURFACE));
    act(() => result.current.save("One"));
    const id = result.current.views[0]?.id ?? "";
    act(() => result.current.remove(id));
    expect(result.current.views).toHaveLength(0);
  });

  it("ignores malformed JSON in localStorage without throwing", () => {
    localStorage.setItem("teranga:saved-views:" + SURFACE, "not json");
    const { result } = renderHook(() => useSavedViews(SURFACE));
    expect(result.current.views).toEqual([]);
  });

  it("apply() pushes the stored querystring onto the router", () => {
    __qs = new URLSearchParams("a=1");
    const { result } = renderHook(() => useSavedViews(SURFACE));
    act(() => result.current.save("Saved"));
    const view = result.current.views[0]!;

    act(() => result.current.apply(view, "/admin/orgs"));
    expect(pushSpy).toHaveBeenCalledWith("/admin/orgs?a=1");
  });

  it("apply() pushes a bare pathname when the view has no query", () => {
    __qs = new URLSearchParams();
    const { result } = renderHook(() => useSavedViews(SURFACE));
    act(() => result.current.save("No filters"));
    const view = result.current.views[0]!;

    act(() => result.current.apply(view, "/admin/orgs"));
    expect(pushSpy).toHaveBeenCalledWith("/admin/orgs");
  });

  it("activeViewId matches when the current query equals a saved view", () => {
    __qs = new URLSearchParams("a=1&b=2");
    const { result } = renderHook(() => useSavedViews(SURFACE));
    act(() => result.current.save("Current"));
    // Re-render with identical query — should be detected as active.
    const re = renderHook(() => useSavedViews(SURFACE));
    expect(re.result.current.activeViewId).toBe(result.current.views[0]?.id);
  });
});
