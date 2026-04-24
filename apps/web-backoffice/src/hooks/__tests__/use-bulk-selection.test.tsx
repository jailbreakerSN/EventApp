import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBulkSelection } from "../use-bulk-selection";

/**
 * Contract tests for the selection primitive used by every admin bulk
 * surface. The hook is identity-agnostic, but the admin pages always
 * drive it with string ids — the tests match that usage.
 */
describe("useBulkSelection", () => {
  it("starts empty, toggles individual rows, and exposes count + selected ids", () => {
    const { result } = renderHook(() => useBulkSelection<string>(["a", "b", "c"]));

    expect(result.current.size).toBe(0);
    expect(result.current.hasSelection).toBe(false);
    expect(result.current.selectAllState).toBe("none");

    act(() => result.current.toggle("a"));
    expect(result.current.size).toBe(1);
    expect(result.current.isSelected("a")).toBe(true);
    expect(result.current.isSelected("b")).toBe(false);
    expect(result.current.selectAllState).toBe("some");

    act(() => result.current.toggle("a"));
    expect(result.current.size).toBe(0);
    expect(result.current.isSelected("a")).toBe(false);
  });

  it("toggleAll selects every row on the page and flips back to empty", () => {
    const { result } = renderHook(() => useBulkSelection<string>(["a", "b", "c"]));

    act(() => result.current.toggleAll(true));
    expect(result.current.size).toBe(3);
    expect(result.current.selectAllState).toBe("all");
    expect(result.current.selectAllChecked).toBe(true);

    act(() => result.current.toggleAll(false));
    expect(result.current.size).toBe(0);
    expect(result.current.selectAllState).toBe("none");
  });

  it("clear wipes the selection and returns to 'none' state", () => {
    const { result } = renderHook(() => useBulkSelection<string>(["a", "b"]));

    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("b"));
    expect(result.current.size).toBe(2);

    act(() => result.current.clear());
    expect(result.current.size).toBe(0);
    expect(result.current.hasSelection).toBe(false);
  });

  it("toggleRange selects every id between fromId and toId inclusive", () => {
    const { result } = renderHook(() => useBulkSelection<string>(["a", "b", "c", "d", "e"]));

    act(() => result.current.toggleRange("b", "d", true));
    expect(result.current.isSelected("a")).toBe(false);
    expect(result.current.isSelected("b")).toBe(true);
    expect(result.current.isSelected("c")).toBe(true);
    expect(result.current.isSelected("d")).toBe(true);
    expect(result.current.isSelected("e")).toBe(false);
    expect(result.current.size).toBe(3);
  });

  it("toggleRange deselects every id in the range when nextValue=false", () => {
    const { result } = renderHook(() => useBulkSelection<string>(["a", "b", "c", "d"]));

    act(() => result.current.toggleAll(true));
    expect(result.current.size).toBe(4);

    act(() => result.current.toggleRange("b", "c", false));
    expect(result.current.isSelected("a")).toBe(true);
    expect(result.current.isSelected("b")).toBe(false);
    expect(result.current.isSelected("c")).toBe(false);
    expect(result.current.isSelected("d")).toBe(true);
  });

  it("selectAllState is 'all' only when every item from allIds is selected (not just the same count)", () => {
    // A pagination page with 2 ids — selecting one extra doesn't make it "all".
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useBulkSelection<string>(ids),
      { initialProps: { ids: ["a", "b"] } },
    );

    act(() => result.current.toggle("a"));
    expect(result.current.selectAllState).toBe("some");

    act(() => result.current.toggle("b"));
    expect(result.current.selectAllState).toBe("all");

    // Page ids grow — previously "all" no longer covers the new ids.
    rerender({ ids: ["a", "b", "c"] });
    expect(result.current.selectAllState).toBe("some");
  });
});
