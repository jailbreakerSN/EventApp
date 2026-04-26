"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Recent search history persisted to localStorage. Doctrine MUST for
 * marketplace discovery (`docs/design-system/data-listing.md` §
 * Marketplace discovery — MUST 1: search bar autocomplete with recent
 * searches).
 *
 * Capped at MAX entries; most-recent-first; deduped (re-searching an
 * existing term moves it to the top rather than adding a duplicate).
 * Empty / whitespace-only inputs are ignored. SSR-safe — reads return
 * the empty list during hydration; the first effect tick reconciles
 * with localStorage.
 *
 * Storage key is namespaced so different surfaces (events / venues /
 * organisations directory in the future) keep their own histories.
 */

const MAX_RECENT = 5;
const STORAGE_PREFIX = "teranga:recent-searches:";

interface RecentSearchesAPI {
  recents: string[];
  add: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
}

function readLS(namespace: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${namespace}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, MAX_RECENT);
  } catch {
    // Corrupt storage entry — wipe and start fresh rather than crash on
    // every render with a JSON parse error toast.
    return [];
  }
}

function writeLS(namespace: string, value: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${namespace}`, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — degrade gracefully. The
    // session-scoped state still works, the persistence just doesn't.
  }
}

export function useRecentSearches(namespace: string): RecentSearchesAPI {
  const [recents, setRecents] = useState<string[]>([]);

  // Hydrate from localStorage on mount. The empty initial state means
  // SSR + first paint show no recents (correct — recents are a
  // client-only enhancement). The effect runs once, syncs the list,
  // and subsequent renders see the persisted history.
  useEffect(() => {
    setRecents(readLS(namespace));
  }, [namespace]);

  const add = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setRecents((prev) => {
        // Dedup: same query (case-insensitive) gets moved to the top.
        const lower = trimmed.toLowerCase();
        const filtered = prev.filter((q) => q.toLowerCase() !== lower);
        const next = [trimmed, ...filtered].slice(0, MAX_RECENT);
        writeLS(namespace, next);
        return next;
      });
    },
    [namespace],
  );

  const remove = useCallback(
    (query: string) => {
      const lower = query.toLowerCase();
      setRecents((prev) => {
        const next = prev.filter((q) => q.toLowerCase() !== lower);
        writeLS(namespace, next);
        return next;
      });
    },
    [namespace],
  );

  const clear = useCallback(() => {
    setRecents([]);
    writeLS(namespace, []);
  }, [namespace]);

  return { recents, add, remove, clear };
}
