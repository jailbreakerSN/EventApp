"use client";

/**
 * Sticky action bar for bulk operations on admin list pages.
 *
 * Appears at the bottom of the viewport whenever at least one row in
 * the paginated list is selected. Hosts the summary count + the
 * contextual Action buttons provided by the caller (e.g. Suspend,
 * Reactivate, Verify). Keeps its own "clear selection" affordance so
 * operators can back out without reloading the page.
 *
 * Design rationale:
 *  - Docked at the bottom so it never hides list rows above (unlike a
 *    modal).
 *  - Count is prominent — a bulk action on 47 rows is materially
 *    different from one on 2, and the operator must see the number
 *    before clicking.
 *  - Actions are passed as children so the bar is agnostic to what
 *    the caller wants to do. Destructive actions should use
 *    `variant="destructive"` on the <Button>.
 *  - `onClear` is always rendered so keyboard-only operators have an
 *    escape hatch without aiming for tiny checkboxes.
 */

import { X } from "lucide-react";
import { Button } from "@teranga/shared-ui";
import { cn } from "@/lib/utils";

interface BulkActionBarProps {
  /** Number of rows currently selected. Bar renders only when > 0. */
  count: number;
  /** Called when the operator clicks "Désélectionner" or presses Escape. */
  onClear: () => void;
  /** The contextual action buttons — render <Button> elements. */
  children?: React.ReactNode;
  /** Optional custom label (default: "éléments sélectionnés"). */
  entityLabel?: { singular: string; plural: string };
  /** Supplementary ClassName for custom positioning in tests. */
  className?: string;
}

export function BulkActionBar({
  count,
  onClear,
  children,
  entityLabel = { singular: "élément sélectionné", plural: "éléments sélectionnés" },
  className,
}: BulkActionBarProps) {
  if (count === 0) return null;

  const label = count === 1 ? entityLabel.singular : entityLabel.plural;

  return (
    <div
      role="region"
      aria-label="Actions en masse"
      className={cn(
        "sticky bottom-4 z-40 mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg",
        "animate-in fade-in-0 slide-in-from-bottom-2",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <span
          className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
          aria-hidden="true"
        >
          {count}
        </span>
        <span className="text-foreground">
          <span className="sr-only">{count} </span>
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {children}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          aria-label="Désélectionner tout"
          className="text-muted-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="ml-1 hidden sm:inline">Désélectionner</span>
        </Button>
      </div>
    </div>
  );
}
