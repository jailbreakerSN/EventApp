"use client";

/**
 * Phase 5 — Reusable bulk-selection state for admin tables.
 *
 * Usage:
 *   const bulk = useBulkSelection<string>(rows.map(r => r.id));
 *   <Checkbox checked={bulk.selectAllChecked}
 *             onCheckedChange={bulk.toggleAll} />
 *   rows.map(r => (
 *     <Checkbox
 *       checked={bulk.isSelected(r.id)}
 *       onCheckedChange={(next) => bulk.toggle(r.id, next)}
 *     />
 *   ))
 *   {bulk.size > 0 && <BulkActionsBar count={bulk.size} ... />}
 *
 * Features:
 *   - Tri-state header checkbox (all / none / some selected)
 *   - Shift-click range selection via `toggleRange(lastId, currentId)`
 *   - `clear()` after a bulk op succeeds
 *   - `selectedIds` memoised so callers can pass it to an API action
 *
 * The hook is identity-agnostic: the caller picks the ID type (string
 * for most tables, number for sequences, etc). Works on top of any
 * data-table — no coupling to <DataTable> from shared-ui.
 */

import { useCallback, useMemo, useState } from "react";

export interface BulkSelection<T extends string | number> {
  /** Set of currently selected IDs. */
  selectedIds: ReadonlySet<T>;
  /** Number of selected rows. */
  size: number;
  /** True if at least one row is selected. */
  hasSelection: boolean;
  /** "all" | "some" | "none" — drives tri-state header checkbox. */
  selectAllState: "all" | "some" | "none";
  /** Whether the header "select all" checkbox should render checked. */
  selectAllChecked: boolean;
  /** Toggle a single row. */
  toggle: (id: T, nextValue?: boolean) => void;
  /** Select / deselect every row on the current page. */
  toggleAll: (nextValue?: boolean) => void;
  /** Range select between two IDs (shift-click semantics). */
  toggleRange: (fromId: T, toId: T, nextValue: boolean) => void;
  /** Check selection state without triggering re-render. */
  isSelected: (id: T) => boolean;
  /** Clear after a successful bulk action. */
  clear: () => void;
}

export function useBulkSelection<T extends string | number>(
  allIds: readonly T[],
): BulkSelection<T> {
  const [selected, setSelected] = useState<Set<T>>(() => new Set());

  const toggle = useCallback((id: T, nextValue?: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const shouldAdd = nextValue ?? !prev.has(id);
      if (shouldAdd) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (nextValue?: boolean) => {
      setSelected((prev) => {
        const hasAny = prev.size > 0;
        const shouldSelectAll = nextValue ?? !hasAny;
        return shouldSelectAll ? new Set(allIds) : new Set();
      });
    },
    [allIds],
  );

  const toggleRange = useCallback(
    (fromId: T, toId: T, nextValue: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const fromIdx = allIds.indexOf(fromId);
        const toIdx = allIds.indexOf(toId);
        if (fromIdx < 0 || toIdx < 0) return next;
        const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        for (let i = lo; i <= hi; i++) {
          const id = allIds[i];
          if (nextValue) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [allIds],
  );

  const isSelected = useCallback((id: T) => selected.has(id), [selected]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const selectAllState: "all" | "some" | "none" = useMemo(() => {
    if (selected.size === 0) return "none";
    if (selected.size >= allIds.length && allIds.every((id) => selected.has(id))) return "all";
    return "some";
  }, [selected, allIds]);

  return {
    selectedIds: selected,
    size: selected.size,
    hasSelection: selected.size > 0,
    selectAllState,
    selectAllChecked: selectAllState === "all",
    toggle,
    toggleAll,
    toggleRange,
    isSelected,
    clear,
  };
}
