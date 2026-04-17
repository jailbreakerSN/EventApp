import * as React from "react";
import { cn } from "../lib/utils";

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Small uppercase mono-kicker label above the title (e.g. "— À LA UNE"). */
  kicker: string;
  /** Display title rendered as Fraunces serif. */
  title: string;
  /** Optional deck/subtitle copy under the title. */
  subtitle?: string;
  /**
   * Optional right-aligned action slot (filter chip, count pill, CTA link, etc).
   * Parent controls the action element entirely — the primitive only provides the layout.
   */
  action?: React.ReactNode;
  /** Render the title as a different heading level. Defaults to `h2`. */
  as?: "h1" | "h2" | "h3";
}

/**
 * Editorial section header used across the participant app.
 * Mono kicker + Fraunces title + optional deck + optional right-aligned action slot.
 */
const SectionHeader = React.forwardRef<HTMLDivElement, SectionHeaderProps>(
  ({ kicker, title, subtitle, action, as = "h2", className, ...rest }, ref) => {
    const TitleTag = as;
    return (
      <div
        ref={ref}
        className={cn("flex flex-wrap items-end justify-between gap-6", className)}
        {...rest}
      >
        <div className="max-w-[640px]">
          <p className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.14em] text-teranga-gold-dark">
            {kicker}
          </p>
          <TitleTag className="font-serif-display mt-2.5 text-3xl font-semibold leading-[1.08] tracking-[-0.02em] sm:text-4xl lg:text-[36px]">
            {title}
          </TitleTag>
          {subtitle && (
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    );
  },
);
SectionHeader.displayName = "SectionHeader";

export { SectionHeader };
