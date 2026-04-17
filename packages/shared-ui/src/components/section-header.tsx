import * as React from "react";
import { cn } from "../lib/utils";

export type SectionHeaderSize = "section" | "hero";

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
  /**
   * Title scale.
   * - "section" (default): text-3xl / sm:text-4xl / lg:text-[36px] — for in-page editorial sections.
   * - "hero": text-[40px] / sm:text-[48px] — for page-level heroes (My Events dashboard etc).
   */
  size?: SectionHeaderSize;
}

const TITLE_SIZE_CLASSES: Record<SectionHeaderSize, string> = {
  section:
    "mt-2.5 text-3xl font-semibold leading-[1.08] tracking-[-0.02em] sm:text-4xl lg:text-[36px]",
  hero: "mt-2.5 text-[40px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[48px]",
};

/**
 * Editorial section header used across the participant app.
 * Mono kicker + Fraunces title + optional deck + optional right-aligned action slot.
 *
 * Two title scales via `size`:
 * - "section" (default): h2-like scale for in-page editorial sections.
 * - "hero": h1-like scale for page-level heroes (My Events dashboard, etc).
 */
const SectionHeader = React.forwardRef<HTMLDivElement, SectionHeaderProps>(
  (
    { kicker, title, subtitle, action, as = "h2", size = "section", className, ...rest },
    ref,
  ) => {
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
          <TitleTag className={cn("font-serif-display", TITLE_SIZE_CLASSES[size])}>
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
