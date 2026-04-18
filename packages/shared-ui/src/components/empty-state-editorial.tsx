import * as React from "react";
import { cn } from "../lib/utils";

export interface EmptyStateEditorialProps {
  /** Optional small uppercase mono-kicker rendered above the title. */
  kicker?: string;
  /** Title rendered in Fraunces serif. */
  title: string;
  /** Optional supporting description under the title. */
  description?: string;
  /** Optional action slot — typically a `<Button>` or a link wrapped one. */
  action?: React.ReactNode;
  /**
   * Optional Lucide icon component rendered centred above the kicker
   * (e.g. `Bookmark`, `Calendar`). Consumer owns the import — we accept
   * the component itself rather than a rendered node so the primitive
   * controls sizing.
   */
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}

/**
 * Editorial variant of the empty-state pattern, distinct from the plain
 * `<EmptyState>` primitive. Used on the participant app's /my-events
 * Saved + Past tabs to keep the "nothing here yet" moment on-brand.
 *
 * Visual notes:
 * - `border-2 border-dashed border-teranga-gold-soft` (gold outline, not the
 *   default muted border — reinforces the editorial voice).
 * - `bg-teranga-gold-whisper/30` tint (subtle, brand-aware warmth).
 * - Centre-aligned Fraunces serif title + mono kicker.
 * - Generous vertical padding (py-14 sm:py-16) so the block feels
 *   intentional, not accidental.
 *
 * Kept as a *new* component — the existing `<EmptyState>` is preserved
 * untouched for callers that want the simpler, bordered card pattern.
 */
function EmptyStateEditorial({
  kicker,
  title,
  description,
  action,
  icon: Icon,
  className,
}: EmptyStateEditorialProps) {
  return (
    <div
      className={cn(
        "rounded-tile border-2 border-dashed border-teranga-gold-soft bg-teranga-gold-whisper/30",
        "px-6 py-14 text-center sm:py-16",
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden="true"
          className="mx-auto mb-4 h-10 w-10 text-teranga-gold-dark/70"
        />
      )}
      {kicker && (
        <p className="font-mono-kicker mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-teranga-gold-dark">
          {kicker}
        </p>
      )}
      <h3 className="font-serif-display text-2xl font-semibold tracking-[-0.015em] text-foreground sm:text-[28px]">
        {title}
      </h3>
      {description && (
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export { EmptyStateEditorial };
