"use client";

import * as React from "react";
import type { JSX } from "react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { BottomSheet, BottomSheetBody, BottomSheetFooter } from "./bottom-sheet";

/**
 * Mobile filter pattern from the data-listing doctrine § Marketplace
 * discovery. Wraps <BottomSheet> with the canonical structure: scrollable
 * body of filter groups + sticky footer with the live "Voir N résultats"
 * CTA.
 *
 * Pages own the filter widgets (multi-select, date range, etc.) and pass
 * them as `children`. The sheet holds the chrome — title, description,
 * footer count, and clear-all link — so the layout stays identical across
 * the participant app's discovery surfaces.
 *
 * Doctrine MUST: live count reflects the result count for the *pending*
 * filter state, not the URL state. The consumer queries the same API the
 * page uses with the in-progress filter values and passes the count to
 * `liveCount`. While the count is loading, the prop is `undefined` and the
 * CTA shows "Voir …".
 */

export interface FiltersBottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Localised sheet title. Defaults to French "Filtres". */
  title?: React.ReactNode;
  /** Subtitle under the title — typically "{N} filtres actifs". */
  description?: React.ReactNode;
  /** Live result count for the pending filter state. `undefined` while
   *  loading; renders "Voir …" instead of "Voir N résultats". */
  liveCount?: number;
  /** Apply-and-close handler. Called when the user taps the primary CTA
   *  in the footer. Pages typically just call setOpen(false) — the URL
   *  state has already been mutating live as the user toggled chips. */
  onApply: () => void;
  /** Optional clear-all handler shown as a ghost link in the footer.
   *  Hide entirely by passing `undefined`. Convention: surface only when
   *  at least one filter is active. */
  onClearAll?: () => void;
  /** Override the primary CTA copy. Receives the live count (or null
   *  while loading) so callers can localise singular / plural / loading. */
  applyLabel?: (count: number | null) => string;
  /** Override the clear-all link copy. Defaults to "Tout effacer". */
  clearAllLabel?: string;
  /** Filter widgets rendered inside the scrollable body. Pages provide
   *  whatever combination of <MultiSelect>, <DateRange>, etc. they need. */
  children: React.ReactNode;
  className?: string;
}

const DEFAULT_APPLY_LABEL = (count: number | null): string => {
  if (count === null) return "Voir les résultats";
  if (count === 0) return "Aucun résultat";
  if (count === 1) return "Voir 1 résultat";
  return `Voir ${count.toLocaleString("fr-FR")} résultats`;
};

export function FiltersBottomSheet({
  open,
  onOpenChange,
  title = "Filtres",
  description,
  liveCount,
  onApply,
  onClearAll,
  applyLabel = DEFAULT_APPLY_LABEL,
  clearAllLabel = "Tout effacer",
  children,
  className,
}: FiltersBottomSheetProps): JSX.Element {
  const countForLabel = typeof liveCount === "number" ? liveCount : null;
  const ctaLabel = applyLabel(countForLabel);
  const ctaDisabled = countForLabel === 0;

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className={className}
    >
      <BottomSheetBody className={cn("space-y-5")}>{children}</BottomSheetBody>
      <BottomSheetFooter>
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
        ) : (
          // Spacer so the apply CTA stays right-aligned even without
          // clear-all. Keeps the footer geometry stable across states.
          <span aria-hidden="true" />
        )}
        <Button
          type="button"
          onClick={onApply}
          disabled={ctaDisabled}
          // Live region so screen readers narrate the count update without
          // moving focus. Polite — the dropdown is already announced when
          // it opens.
          aria-live="polite"
        >
          {ctaLabel}
        </Button>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
