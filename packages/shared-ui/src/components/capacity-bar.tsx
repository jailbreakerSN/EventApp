import * as React from "react";
import { cn } from "../lib/utils";

export interface CapacityBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Registered count (numerator). */
  registered: number;
  /** Maximum capacity (denominator). When null/0, the component renders nothing. */
  capacity: number | null | undefined;
  /** Left-side label shown under the bar (e.g. "85% rempli"). */
  percentLabel: string;
  /** Right-side label shown under the bar (e.g. "15 places restantes" or "Complet"). */
  seatsLabel: string;
  /**
   * When true, renders a small green pulse dot next to the percent label.
   * The dot uses the `teranga-pulse-dot` CSS class; consumers must declare that
   * keyframe in their global stylesheet (present in apps/web-participant/src/app/globals.css).
   */
  pulseDot?: boolean;
  /** Accessible label for the progress meter. Defaults to the percentLabel. */
  ariaLabel?: string;
}

/**
 * Editorial capacity meter: 6px height bar with a gold → clay gradient fill,
 * mono percent label on the left, mono seats-remaining label on the right.
 *
 * Matches the attendee-capacity block in the public event detail sidebar.
 * The parent owns the i18n strings (percentLabel, seatsLabel) so the primitive
 * stays framework-agnostic — no next-intl dependency.
 *
 * When `capacity` is null/undefined/0 the component renders nothing, which
 * mirrors the original `capacityPct !== null && event.maxAttendees && (...)`
 * guard from the events detail page.
 */
const CapacityBar = React.forwardRef<HTMLDivElement, CapacityBarProps>(
  (
    { registered, capacity, percentLabel, seatsLabel, pulseDot = false, ariaLabel, className, ...rest },
    ref,
  ) => {
    if (!capacity || capacity <= 0) return null;
    const pct = Math.min(100, Math.max(0, Math.round((registered / capacity) * 100)));

    return (
      <div ref={ref} className={cn("w-full", className)} {...rest}>
        <div
          role="progressbar"
          aria-label={ariaLabel ?? percentLabel}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-teranga-gold to-teranga-clay transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            {percentLabel}
            {pulseDot && (
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full bg-teranga-green teranga-pulse-dot"
              />
            )}
          </span>
          <span>{seatsLabel}</span>
        </div>
      </div>
    );
  },
);
CapacityBar.displayName = "CapacityBar";

export { CapacityBar };
