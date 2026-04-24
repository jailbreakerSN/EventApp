"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * T3.2 — Saved views (localStorage-backed) for admin list pages.
 *
 * Industry precedent: Linear (inbox filters), Notion (database
 * views), Stripe Radar (query saves). Each saved view is a named
 * URL querystring; restoring a view is a client-side router push.
 *
 * Storage model:
 *   - One localStorage entry per surface: `teranga:saved-views:<key>`
 *   - Array of `{ id, name, createdAt, query }` rows.
 *   - Max 10 views per surface (generous for admin workloads; keeps
 *     the UI flat without needing pagination).
 *
 * Why not Firestore per-user: cross-device sync is a nice-to-have,
 * not a must-have, and the data volume is trivial. localStorage
 * keeps the hot path free of network round-trips. If ops ever
 * needs "my views on phone and desktop" we can mirror to a
 * per-user doc later.
 */

export interface SavedView {
  id: string;
  name: string;
  createdAt: string;
  /** The raw querystring (without the leading `?`). */
  query: string;
}

const STORAGE_KEY_PREFIX = "teranga:saved-views:";
const MAX_VIEWS_PER_SURFACE = 10;

function storageKey(surfaceKey: string): string {
  return STORAGE_KEY_PREFIX + surfaceKey;
}

function readViews(surfaceKey: string): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(surfaceKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (v): v is SavedView =>
          v &&
          typeof v.id === "string" &&
          typeof v.name === "string" &&
          typeof v.createdAt === "string" &&
          typeof v.query === "string",
      )
      .slice(0, MAX_VIEWS_PER_SURFACE);
  } catch {
    return [];
  }
}

function writeViews(surfaceKey: string, views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(surfaceKey), JSON.stringify(views));
  } catch {
    // Quota exceeded / private mode — skip.
  }
}

export function useSavedViews(surfaceKey: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [views, setViews] = useState<SavedView[]>([]);

  // Hydrate on mount. We intentionally wait for the client render so
  // SSR and the first client render agree (empty list).
  useEffect(() => {
    setViews(readViews(surfaceKey));
  }, [surfaceKey]);

  const currentQuery = useMemo(() => {
    return searchParams?.toString() ?? "";
  }, [searchParams]);

  const activeViewId = useMemo(() => {
    for (const v of views) {
      if (v.query === currentQuery) return v.id;
    }
    return null;
  }, [views, currentQuery]);

  const save = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setViews((prev) => {
        // Dedup by name (case-insensitive): overwrite the existing
        // entry's query if the user reuses the name.
        const normalized = trimmed.toLowerCase();
        const next = prev.filter((v) => v.name.toLowerCase() !== normalized);
        next.unshift({
          id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: trimmed,
          createdAt: new Date().toISOString(),
          query: currentQuery,
        });
        const capped = next.slice(0, MAX_VIEWS_PER_SURFACE);
        writeViews(surfaceKey, capped);
        return capped;
      });
    },
    [currentQuery, surfaceKey],
  );

  const remove = useCallback(
    (id: string) => {
      setViews((prev) => {
        const next = prev.filter((v) => v.id !== id);
        writeViews(surfaceKey, next);
        return next;
      });
    },
    [surfaceKey],
  );

  const apply = useCallback(
    (view: SavedView, pathname: string) => {
      const target = view.query ? `${pathname}?${view.query}` : pathname;
      router.push(target);
    },
    [router],
  );

  return {
    views,
    activeViewId,
    save,
    remove,
    apply,
    currentQuery,
  };
}

// ─── Keyboard row-nav (T3.2) ──────────────────────────────────────────────

/**
 * Minimal j / k / Enter / Esc row-nav for admin list pages. The caller
 * supplies (1) the number of rows, (2) a callback that opens the row's
 * detail view, (3) a callback that clears focus (Esc). Focused row
 * index is returned so the consumer can apply visual state.
 *
 * We deliberately keep this lean — no data-attribute scanning, no
 * imperative focus calls. The caller attaches `aria-selected` based
 * on the returned index and gets keyboard-first discovery for free.
 */
export function useRowKeyboardNav(
  rowCount: number,
  options: {
    onOpen: (index: number) => void;
    enabled?: boolean;
  },
) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const { onOpen, enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing into a field — otherwise filter inputs become
      // unusable.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (target && (target as HTMLElement).isContentEditable)
      ) {
        return;
      }
      if (rowCount === 0) return;
      switch (e.key) {
        case "j":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(rowCount - 1, i < 0 ? 0 : i + 1));
          break;
        case "k":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(0, i - 1));
          break;
        case "Enter":
          if (focusedIndex >= 0 && focusedIndex < rowCount) {
            e.preventDefault();
            onOpen(focusedIndex);
          }
          break;
        case "Escape":
          setFocusedIndex(-1);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rowCount, focusedIndex, onOpen, enabled]);

  // Reset focus when the dataset shrinks.
  useEffect(() => {
    if (focusedIndex >= rowCount) setFocusedIndex(-1);
  }, [rowCount, focusedIndex]);

  return {
    focusedIndex,
    setFocusedIndex,
  };
}
