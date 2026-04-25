import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRowKeyboardNav } from "../use-row-keyboard-nav";

/**
 * Sprint-1 B2 closure — contract tests for the row-level keyboard
 * navigation hook used by every admin list (users / orgs / events /
 * audit). The hook owns the active-row index and dispatches an
 * `onSelect` callback when the operator presses Enter.
 */

function fireKey(key: string, opts: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, ...opts });
  window.dispatchEvent(event);
}

describe("useRowKeyboardNav", () => {
  beforeEach(() => {
    // Each test starts with a clean DOM so dialog detection is reliable.
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts at index -1 and advances on j/ArrowDown", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useRowKeyboardNav({ items: ["a", "b", "c"], onSelect }),
    );

    expect(result.current.activeIndex).toBe(-1);

    act(() => fireKey("j"));
    expect(result.current.activeIndex).toBe(0);

    act(() => fireKey("ArrowDown"));
    expect(result.current.activeIndex).toBe(1);
  });

  it("rewinds on k/ArrowUp without going below zero", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useRowKeyboardNav({ items: ["a", "b"], onSelect }),
    );

    act(() => fireKey("ArrowDown"));
    act(() => fireKey("ArrowDown"));
    expect(result.current.activeIndex).toBe(1);

    act(() => fireKey("k"));
    expect(result.current.activeIndex).toBe(0);

    // Already at 0 — stays at 0
    act(() => fireKey("k"));
    expect(result.current.activeIndex).toBe(0);
  });

  it("Home/End jump to first/last", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useRowKeyboardNav({ items: ["a", "b", "c"], onSelect }),
    );

    act(() => fireKey("End"));
    expect(result.current.activeIndex).toBe(2);

    act(() => fireKey("Home"));
    expect(result.current.activeIndex).toBe(0);
  });

  it("Enter triggers onSelect with the active item", () => {
    const onSelect = vi.fn();
    renderHook(() => useRowKeyboardNav({ items: ["a", "b", "c"], onSelect }));

    act(() => fireKey("ArrowDown"));
    act(() => fireKey("ArrowDown"));
    act(() => fireKey("Enter"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("b", 1);
  });

  it("Escape clears the active index", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useRowKeyboardNav({ items: ["a", "b"], onSelect }),
    );

    act(() => fireKey("ArrowDown"));
    expect(result.current.activeIndex).toBe(0);

    act(() => fireKey("Escape"));
    expect(result.current.activeIndex).toBe(-1);
  });

  it("ignores keystrokes when an input is focused", () => {
    const onSelect = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const { result } = renderHook(() =>
      useRowKeyboardNav({ items: ["a", "b"], onSelect }),
    );

    act(() => {
      const event = new KeyboardEvent("keydown", { key: "j", bubbles: true });
      Object.defineProperty(event, "target", { value: input });
      window.dispatchEvent(event);
    });

    expect(result.current.activeIndex).toBe(-1);
  });

  it("ignores keystrokes when a dialog is open", () => {
    const onSelect = vi.fn();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);

    const { result } = renderHook(() =>
      useRowKeyboardNav({ items: ["a", "b"], onSelect }),
    );

    act(() => fireKey("j"));
    expect(result.current.activeIndex).toBe(-1);
  });

  it("clamps the active index when the list shrinks", () => {
    const onSelect = vi.fn();
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => useRowKeyboardNav({ items, onSelect }),
      { initialProps: { items: ["a", "b", "c", "d"] } },
    );

    act(() => fireKey("End"));
    expect(result.current.activeIndex).toBe(3);

    rerender({ items: ["a", "b"] });
    expect(result.current.activeIndex).toBe(-1);
  });

  it("respects enabled=false", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useRowKeyboardNav({ items: ["a", "b"], onSelect, enabled: false }),
    );

    act(() => fireKey("j"));
    expect(result.current.activeIndex).toBe(-1);
  });
});
