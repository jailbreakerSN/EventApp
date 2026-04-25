"use client";

/**
 * Sprint-1 B2 closure — Row-level keyboard navigation for admin lists.
 *
 * Power-user keybindings:
 *   - `j` / `ArrowDown`   → highlight next row
 *   - `k` / `ArrowUp`     → highlight previous row
 *   - `Enter`             → trigger `onSelect(item)` on the highlighted row
 *   - `Esc`               → clear highlight + drop focus
 *   - `Home` / `End`      → first / last row
 *
 * Disabled while an input / textarea / contenteditable element is focused
 * so typing inside a search bar never accidentally jumps the active row.
 * Disabled while the ⌘K command palette is open (modal context) by
 * checking for `[data-cmdk-root]` — the existing palette uses this
 * attribute on its dialog container.
 *
 * Usage:
 *
 *   const { activeIndex, setActiveIndex } = useRowKeyboardNav({
 *     items: events,
 *     onSelect: (e) => router.push(`/admin/events/${e.id}`),
 *   });
 *
 *   {events.map((e, idx) => (
 *     <Row
 *       key={e.id}
 *       data-active={idx === activeIndex}
 *       onMouseEnter={() => setActiveIndex(idx)}
 *     />
 *   ))}
 */

import { useCallback, useEffect, useState } from "react";

interface Options<T> {
  items: T[];
  onSelect: (item: T, index: number) => void;
  /**
   * When true (default) the hook attaches a global `keydown` listener.
   * Pages that want to opt-out per-render (e.g. while a custom dialog
   * is open) can pass `enabled: false`.
   */
  enabled?: boolean;
}

export function useRowKeyboardNav<T>({ items, onSelect, enabled = true }: Options<T>) {
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Reset when the underlying list changes shape so a stale index never
  // points past the end of the page-2 slice.
  useEffect(() => {
    setActiveIndex((prev) => (prev >= items.length ? -1 : prev));
  }, [items.length]);

  const isTypingTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };

  const isInDialog = (): boolean => {
    if (typeof document === "undefined") return false;
    // Modern dialog primitives + the ⌘K palette + the impersonation
    // confirmation share a `[role="dialog"]` or `[data-cmdk-root]`
    // ancestor on whatever has focus. If any of those are mounted
    // and visible we yield to the modal's own keymap.
    return (
      !!document.querySelector('[role="dialog"][aria-modal="true"]') ||
      !!document.querySelector("[data-cmdk-root]")
    );
  };

  const select = useCallback(
    (index: number) => {
      if (index < 0 || index >= items.length) return;
      onSelect(items[index], index);
    },
    [items, onSelect],
  );

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const handler = (event: KeyboardEvent) => {
      // Never steal keystrokes from a typing surface or a modal.
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isInDialog()) return;

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex((prev) => Math.min(items.length - 1, prev + 1));
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex((prev) => Math.max(0, prev <= 0 ? 0 : prev - 1));
          break;
        case "Home":
          event.preventDefault();
          if (items.length > 0) setActiveIndex(0);
          break;
        case "End":
          event.preventDefault();
          if (items.length > 0) setActiveIndex(items.length - 1);
          break;
        case "Enter":
          if (activeIndex >= 0) {
            event.preventDefault();
            select(activeIndex);
          }
          break;
        case "Escape":
          if (activeIndex >= 0) {
            event.preventDefault();
            setActiveIndex(-1);
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, items.length, activeIndex, select]);

  return { activeIndex, setActiveIndex };
}
