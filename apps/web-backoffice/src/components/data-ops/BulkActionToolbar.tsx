"use client";

/**
 * Organizer overhaul — Phase O7.
 *
 * Generic floating toolbar that appears when at least one row is
 * selected in a bulk-enabled table. Hosts the verbs the operator
 * can apply to the selection (cancel, tag, export, send-broadcast,
 * delete…). The verbs are passed in as `actions` so the toolbar is
 * fully reusable across surfaces.
 *
 * Visual contract:
 *   - Sticky at the bottom of the page within its container, with a
 *     gold accent — visually distinct from the table chrome.
 *   - "X sélectionné(s)" counter on the left, action buttons on the
 *     right, "Désélectionner" link as the rightmost escape hatch.
 *   - Plays nice with sub-layouts (the sticky positioning targets the
 *     viewport bottom via fixed positioning when `floating=true`).
 */

import { type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BulkAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "destructive";
}

export interface BulkActionToolbarProps {
  selectedCount: number;
  actions: readonly BulkAction[];
  onClearSelection: () => void;
  /** When true, the toolbar floats fixed at the viewport bottom. */
  floating?: boolean;
  /** Optional content rendered between the counter and the actions. */
  middleSlot?: ReactNode;
  className?: string;
}

export function BulkActionToolbar({
  selectedCount,
  actions,
  onClearSelection,
  floating = false,
  middleSlot,
  className,
}: BulkActionToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Actions groupées"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-teranga-gold/40 bg-teranga-gold/5 px-4 py-2.5 shadow-sm",
        floating &&
          "fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[min(960px,calc(100vw-2rem))]",
        className,
      )}
    >
      <span className="text-xs font-semibold text-teranga-gold">
        {selectedCount} sélectionné{selectedCount > 1 ? "s" : ""}
      </span>

      {middleSlot && <div className="flex items-center gap-2">{middleSlot}</div>}

      <div className="flex items-center gap-1.5 ml-auto">
        {actions.map((action) => {
          const Icon = action.icon;
          const isDestructive = action.variant === "destructive";
          return (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium motion-safe:transition-colors",
                isDestructive
                  ? "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
                  : "border-border bg-background text-foreground hover:bg-accent",
                action.disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
              {action.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onClearSelection}
        aria-label="Désélectionner tout"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" aria-hidden="true" />
        Désélectionner
      </button>
    </div>
  );
}
