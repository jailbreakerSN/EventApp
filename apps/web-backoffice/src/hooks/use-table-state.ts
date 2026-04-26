"use client";

import { useQueryStates, type Parser, parseAsInteger, parseAsString, parseAsStringEnum } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Single source of truth for the URL state of any list page in the
 * backoffice. The doctrine (`docs/design-system/data-listing.md`) mandates
 * that no list page reads `searchParams` or calls `router.push` directly
 * for q/filters/sort/page/pageSize — they all flow through this hook.
 *
 * Step 2 of the doctrine documents the behavioural contract; this file is
 * its only sanctioned implementation. Mirror in apps/web-participant if
 * you need it there.
 */

export type SortDirection = "asc" | "desc";

export interface SortState<TField extends string = string> {
  field: TField;
  dir: SortDirection;
}

const PAGE_SIZE_VALUES = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_VALUES)[number];

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZE_VALUES as readonly number[]).includes(value);
}

export interface UseTableStateOptions<TFilters extends Record<string, unknown>> {
  /** Page-scoped namespace, e.g. "users" → ?users.q=…&users.role=…. Empty
   *  string for the canonical page on a route (no prefix). Required when
   *  multiple tables coexist on a single route. */
  urlNamespace?: string;
  /** Defaults applied when a key is absent from the URL. */
  defaults: {
    sort?: SortState | null;
    pageSize?: PageSize;
    filters?: Partial<TFilters>;
  };
  /** Whitelist of sortable fields. Anything outside falls back to defaults.sort. */
  sortableFields: readonly string[];
  /** Whitelist of filter keys + their nuqs parsers. Parsers produce the
   *  non-nullable type; absent filters are represented as `undefined` in
   *  the resulting `filters` object (nuqs's `null` is mapped to undefined). */
  filterParsers: { [K in keyof TFilters]: Parser<NonNullable<TFilters[K]>> };
  /** Debounce delay for `q` only, in ms. Default 300. */
  debounceMs?: number;
}

export interface UseTableStateResult<TFilters> {
  q: string;
  debouncedQ: string;
  filters: TFilters;
  sort: SortState | null;
  page: number;
  pageSize: PageSize;
  activeFilterCount: number;
  setQ: (next: string) => void;
  setFilter: <K extends keyof TFilters>(key: K, value: TFilters[K] | undefined) => void;
  toggleSort: (field: string) => void;
  setPage: (next: number) => void;
  setPageSize: (next: PageSize) => void;
  reset: () => void;
}

const PAGE_SIZE_LS_PREFIX = "table:pageSize:";
const DENSITY_LS_PREFIX = "table:density:";
export type Density = "compact" | "comfortable";

function readPageSizeLS(namespace: string, fallback: PageSize): PageSize {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(`${PAGE_SIZE_LS_PREFIX}${namespace}`);
  const num = raw ? Number(raw) : NaN;
  return Number.isFinite(num) && isPageSize(num) ? num : fallback;
}

function writePageSizeLS(namespace: string, value: PageSize): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${PAGE_SIZE_LS_PREFIX}${namespace}`, String(value));
}

export function readDensityLS(namespace: string, fallback: Density = "comfortable"): Density {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(`${DENSITY_LS_PREFIX}${namespace}`);
  return raw === "compact" || raw === "comfortable" ? raw : fallback;
}

export function writeDensityLS(namespace: string, value: Density): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${DENSITY_LS_PREFIX}${namespace}`, value);
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

export function useTableState<TFilters extends Record<string, unknown>>(
  options: UseTableStateOptions<TFilters>,
): UseTableStateResult<TFilters> {
  const namespace = options.urlNamespace ?? "";
  const debounceMs = options.debounceMs ?? 300;
  const defaultPageSize: PageSize = options.defaults.pageSize ?? 25;
  const defaultSort = options.defaults.sort ?? null;

  // Build the nuqs map. nuqs key prefix lives at the option level — we
  // namespace by hand so callers can mix multiple tables on one route.
  const k = (suffix: string): string => (namespace ? `${namespace}.${suffix}` : suffix);

  // ── q ────────────────────────────────────────────────────────────────
  const [{ q }, setQUrl] = useQueryStates(
    { [k("q")]: parseAsString.withDefault("") },
    { history: "replace", shallow: true, throttleMs: 50 },
  );
  const debouncedQ = useDebounced(q ?? "", debounceMs);

  // ── filters ──────────────────────────────────────────────────────────
  const filterMap = useMemo(() => {
    const acc: Record<string, Parser<unknown>> = {};
    for (const key of Object.keys(options.filterParsers) as (keyof TFilters)[]) {
      acc[k(String(key))] = options.filterParsers[key] as Parser<unknown>;
    }
    return acc;
  }, [namespace]);

  const [rawFilters, setFiltersUrl] = useQueryStates(filterMap, {
    history: "replace",
    shallow: true,
  });

  const filters = useMemo(() => {
    const out: Record<string, unknown> = { ...(options.defaults.filters ?? {}) };
    for (const key of Object.keys(options.filterParsers) as (keyof TFilters)[]) {
      const value = rawFilters[k(String(key))];
      if (value !== null && value !== undefined) out[String(key)] = value;
    }
    return out as TFilters;
  }, [rawFilters]);

  // ── sort ─────────────────────────────────────────────────────────────
  const sortFieldParser = useMemo(
    () => parseAsStringEnum([...options.sortableFields]),
    [options.sortableFields.join("|")],
  );
  const sortDirParser = useMemo(() => parseAsStringEnum(["asc", "desc"]), []);

  const [{ sortField, sortDir }, setSortUrl] = useQueryStates(
    { [k("sortField")]: sortFieldParser, [k("sortDir")]: sortDirParser },
    { history: "replace", shallow: true },
  );

  const sort: SortState | null = useMemo(() => {
    if (sortField && (sortDir === "asc" || sortDir === "desc")) {
      return { field: sortField, dir: sortDir };
    }
    return defaultSort;
  }, [sortField, sortDir]);

  // ── page + pageSize ──────────────────────────────────────────────────
  const [{ page, pageSize }, setPageUrl] = useQueryStates(
    {
      [k("page")]: parseAsInteger.withDefault(1),
      [k("pageSize")]: parseAsInteger.withDefault(defaultPageSize),
    },
    { history: "replace", shallow: true },
  );

  // pageSize hydration: URL → localStorage → defaults
  const [hydratedPageSize, setHydratedPageSize] = useState<PageSize>(() => {
    const fromUrl = pageSize;
    if (fromUrl && isPageSize(fromUrl)) return fromUrl;
    return readPageSizeLS(namespace || "default", defaultPageSize);
  });

  useEffect(() => {
    if (pageSize && isPageSize(pageSize) && pageSize !== hydratedPageSize) {
      setHydratedPageSize(pageSize);
    }
  }, [pageSize, hydratedPageSize]);

  // ── derived ──────────────────────────────────────────────────────────
  const activeFilterCount = useMemo(() => {
    let n = 0;
    for (const key of Object.keys(options.filterParsers) as (keyof TFilters)[]) {
      const value = rawFilters[k(String(key))];
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (value === "") continue;
      n++;
    }
    return n;
  }, [rawFilters]);

  // ── setters ──────────────────────────────────────────────────────────
  const setQ = useCallback(
    (next: string) => {
      setQUrl({ [k("q")]: next });
      setPageUrl({ [k("page")]: 1, [k("pageSize")]: hydratedPageSize });
    },
    [hydratedPageSize, namespace],
  );

  const setFilter = useCallback(
    <K extends keyof TFilters>(key: K, value: TFilters[K] | undefined) => {
      setFiltersUrl({ [k(String(key))]: value === undefined ? null : value });
      setPageUrl({ [k("page")]: 1, [k("pageSize")]: hydratedPageSize });
    },
    [hydratedPageSize, namespace],
  );

  const toggleSort = useCallback(
    (field: string) => {
      if (!options.sortableFields.includes(field)) return;
      setSortUrl((current) => {
        const cf = current[k("sortField")];
        const cd = current[k("sortDir")];
        // Tri-state: none → asc → desc → none
        if (cf !== field) return { [k("sortField")]: field, [k("sortDir")]: "asc" };
        if (cd === "asc") return { [k("sortField")]: field, [k("sortDir")]: "desc" };
        return { [k("sortField")]: null, [k("sortDir")]: null };
      });
      setPageUrl({ [k("page")]: 1, [k("pageSize")]: hydratedPageSize });
    },
    [options.sortableFields.join("|"), hydratedPageSize, namespace],
  );

  const setPage = useCallback(
    (next: number) => {
      setPageUrl({ [k("page")]: Math.max(1, next), [k("pageSize")]: hydratedPageSize });
    },
    [hydratedPageSize, namespace],
  );

  const setPageSize = useCallback(
    (next: PageSize) => {
      writePageSizeLS(namespace || "default", next);
      setHydratedPageSize(next);
      setPageUrl({ [k("page")]: 1, [k("pageSize")]: next });
    },
    [namespace],
  );

  const reset = useCallback(() => {
    setQUrl({ [k("q")]: null });
    setFiltersUrl(
      Object.fromEntries(
        Object.keys(options.filterParsers).map((key) => [k(String(key)), null]),
      ),
    );
    setSortUrl({ [k("sortField")]: null, [k("sortDir")]: null });
    setPageUrl({ [k("page")]: null, [k("pageSize")]: null });
    setHydratedPageSize(defaultPageSize);
  }, [namespace, defaultPageSize]);

  return {
    q: q ?? "",
    debouncedQ,
    filters,
    sort,
    page: page ?? 1,
    pageSize: hydratedPageSize,
    activeFilterCount,
    setQ,
    setFilter,
    toggleSort,
    setPage,
    setPageSize,
    reset,
  };
}
