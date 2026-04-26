"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Input } from "./input";

/**
 * Toolbar primitives for list pages — see
 * `docs/design-system/data-listing.md` § Frontend primitives. Compose:
 *
 *   <FilterBar
 *     searchValue={state.q}
 *     onSearchChange={state.setQ}
 *     activeChips={[…]}            // <FilterChip> array
 *     onClearAll={state.activeFilterCount >= 2 ? state.reset : undefined}
 *     leftSlot={…}                 // saved-views menu, density toggle, …
 *     rightSlot={…}                // export button, refresh, …
 *   />
 *
 * The bar deliberately offers slots, not opinions. Pages decide what to
 * place where; the doctrine pins the layout, not the contents.
 */

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  searchValue: string;
  onSearchChange: (next: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  activeChips?: React.ReactNode;
  onClearAll?: () => void;
  clearAllLabel?: string;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Rechercher…",
  searchAriaLabel = "Rechercher",
  activeChips,
  onClearAll,
  clearAllLabel = "Tout effacer",
  leftSlot,
  rightSlot,
  className,
  ...rest
}: FilterBarProps): JSX.Element {
  return (
    <div
      role="region"
      aria-label="Barre de filtres"
      className={cn("flex flex-col gap-2", className)}
      {...rest}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 max-w-xl">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            aria-hidden="true"
          />
          <Input
            type="search"
            role="searchbox"
            aria-label={searchAriaLabel}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {leftSlot}
          {rightSlot}
        </div>
      </div>

      {activeChips && (Array.isArray(activeChips) ? activeChips.length > 0 : true) ? (
        <div className="flex flex-wrap items-center gap-2">
          {activeChips}
          {onClearAll ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              className="text-muted-foreground hover:text-foreground"
            >
              {clearAllLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Chip ────────────────────────────────────────────────────────────────

export interface FilterChipProps {
  label: string;
  value: string;
  onRemove: () => void;
  /** Optional override for the screen-reader copy on the close button. */
  removeAriaLabel?: string;
}

/**
 * A single active-filter pill. Backspace / Delete on focus removes it
 * (matches Polaris IndexFilters and the WCAG ARIA APG combobox-with-tags
 * pattern). The onRemove handler is the only sanctioned way to mutate
 * filter state from a chip — the visible label is decorative.
 */
export function FilterChip({
  label,
  value,
  onRemove,
  removeAriaLabel,
}: FilterChipProps): JSX.Element {
  const handleKey = (e: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      onRemove();
    }
  };
  const aria = removeAriaLabel ?? `Retirer le filtre ${label}: ${value}`;
  return (
    <span
      tabIndex={0}
      onKeyDown={handleKey}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={aria}
        className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

// ─── Result count (aria-live) ─────────────────────────────────────────────

export interface ResultCountProps {
  total: number | undefined;
  loading?: boolean;
  /** Override the singular / plural template. */
  format?: (total: number) => string;
}

/**
 * Live result-count announcer. Emits via aria-live="polite" so screen
 * readers narrate the new count after every filter / search change.
 * Doctrine MUST for marketplace discovery and SHOULD for admin tables.
 */
export function ResultCount({ total, loading, format }: ResultCountProps): JSX.Element {
  const fmt =
    format ?? ((n: number) => (n === 1 ? `${n} résultat` : `${n.toLocaleString("fr-FR")} résultats`));
  const text = loading
    ? "Chargement…"
    : typeof total === "number"
      ? fmt(total)
      : "";
  return (
    <p
      role="status"
      aria-live="polite"
      className="text-sm text-muted-foreground"
    >
      {text}
    </p>
  );
}

// ─── Page-size selector ───────────────────────────────────────────────────

export interface PageSizeSelectorProps {
  value: 10 | 25 | 50 | 100;
  onChange: (next: 10 | 25 | 50 | 100) => void;
  options?: ReadonlyArray<10 | 25 | 50 | 100>;
  label?: string;
}

export function PageSizeSelector({
  value,
  onChange,
  options = [10, 25, 50, 100] as const,
  label = "Lignes par page",
}: PageSizeSelectorProps): JSX.Element {
  const id = React.useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-muted-foreground whitespace-nowrap">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as 10 | 25 | 50 | 100)}
        className={cn(
          "h-8 rounded-md border border-input bg-background px-2 text-sm",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}
