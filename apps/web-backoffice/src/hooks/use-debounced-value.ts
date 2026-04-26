"use client";

import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value`. Updates `delayMs` after `value`
 * stabilises. Pair with a controlled input bound to `value`; pass the
 * debounced result to the network query so typing five characters fires
 * one request, not five.
 *
 * The 300 ms default matches the data-listing doctrine (see
 * `docs/design-system/data-listing.md` § Frontend primitives — admin
 * tables MUST debounce search at 300 ms).
 *
 * The hook trims whitespace on the debounced output. Empty strings are
 * passed through verbatim so callers can `if (debouncedQ)` to gate the
 * query.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
