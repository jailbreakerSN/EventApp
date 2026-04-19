import * as React from "react";
import { cn } from "../lib/utils";

export interface EditorialHeroStat {
  /** Big serif number / value (e.g. "412", "38k", "4.8★"). */
  value: string;
  /** Mono uppercase label under the value. */
  label: string;
}

export interface EditorialHeroProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** Small uppercase mono-kicker label above the title. */
  kicker?: string;
  /**
   * Display title rendered in Fraunces serif. Accepts ReactNode so callers
   * can inject italic spans, line breaks, or a visually-hidden SEO heading
   * alongside a decorative `aria-hidden` composition.
   */
  title: React.ReactNode;
  /** Optional lead paragraph rendered below the title. */
  lead?: string;
  /**
   * Visual variant:
   * - "default": light (card) background, gold/navy accents — used for
   *   editorial heroes inside scrollable page sections (e.g. /my-events).
   * - "navy": full-bleed `bg-teranga-navy` hero with radial texture overlay,
   *   440px tall on desktop, white typography — used on the homepage and
   *   event-detail hero.
   */
  variant?: "default" | "navy";
  /**
   * Optional pill row rendered ABOVE the title on the navy variant, and
   * below the kicker on the default variant. Parent owns the pill styling.
   */
  pills?: React.ReactNode;
  /**
   * Optional editorial stats row (typically 2-4 numbers) rendered at the
   * bottom of the hero. Displayed as a responsive `<dl>` with Fraunces
   * values and mono labels. Hidden when empty.
   */
  stats?: EditorialHeroStat[];
  /**
   * Optional primary/secondary CTA slot. On the default variant it sits
   * flush right of the copy column; on the navy variant it wraps under
   * the lead copy.
   */
  actions?: React.ReactNode;
  /**
   * Optional full-bleed background node rendered UNDER the navy texture
   * overlay (navy variant only). Intended for an event cover image —
   * consumers inject their framework's image component (e.g. next/image
   * with `fill`) so the primitive stays framework-agnostic. Ignored on
   * the default variant.
   */
  backgroundNode?: React.ReactNode;
  /** Additional classes appended to the outer `<section>`. */
  className?: string;
}

const TITLE_SIZE: Record<"default" | "navy", string> = {
  // Default: 60-80px scale (matches prototype hero above the fold).
  default:
    "text-[44px] font-semibold leading-[1.02] tracking-[-0.025em] sm:text-[56px] lg:text-[64px] xl:text-[72px]",
  // Navy: 64-72px and slightly tighter tracking — matches event-detail hero.
  navy: "text-4xl font-medium leading-[1] tracking-[-0.028em] sm:text-5xl lg:text-[68px] xl:text-[72px]",
};

/**
 * Editorial page hero used across the participant app.
 *
 * Composes kicker + Fraunces display title + lead copy, plus optional
 * pills (above the title on the navy variant), stats row (below the lead),
 * and actions (flush right on default, wrapping under copy on navy).
 *
 * Two visual variants:
 * - `"default"` — light background for in-page editorial heroes (e.g.
 *   the participant's /my-events dashboard). Gold kicker, navy body type.
 * - `"navy"` — full-bleed navy hero with radial texture overlay, 440px
 *   tall on desktop, white typography. Used on the homepage and event
 *   detail page. Expects to sit flush under the top chrome.
 *
 * The component never hard-codes copy — French strings shown in
 * Storybook are illustrative. Parents pass translated strings.
 */
const EditorialHero = React.forwardRef<HTMLElement, EditorialHeroProps>(
  (
    {
      kicker,
      title,
      lead,
      variant = "default",
      pills,
      stats,
      actions,
      backgroundNode,
      className,
      ...rest
    },
    ref,
  ) => {
    const isNavy = variant === "navy";
    const titleClass = TITLE_SIZE[variant];

    if (isNavy) {
      return (
        <section
          ref={ref}
          className={cn(
            "relative overflow-hidden bg-teranga-navy text-white",
            // Match the event-detail prototype's 380/420/440 responsive heights.
            "min-h-[380px] sm:min-h-[420px] lg:h-[440px]",
            className,
          )}
          {...rest}
        >
          {backgroundNode && (
            <div aria-hidden="true" className="absolute inset-0 z-0 overflow-hidden">
              {backgroundNode}
            </div>
          )}
          <div aria-hidden="true" className="teranga-hero-texture absolute inset-0" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"
          />
          <div className="relative z-10 mx-auto flex h-full max-w-[1280px] flex-col justify-end px-6 pb-10 lg:px-8 lg:pb-12">
            <div className="max-w-[820px]">
              {pills && <div className="mb-5 flex flex-wrap gap-2">{pills}</div>}
              {kicker && (
                <p className="font-mono-kicker mb-4 text-[11px] font-medium uppercase tracking-[0.18em] text-teranga-gold-light">
                  {kicker}
                </p>
              )}
              <h1 className={cn("font-serif-display text-balance", titleClass)}>{title}</h1>
              {lead && (
                <p className="mt-4 max-w-[640px] text-lg leading-relaxed text-white/85 text-pretty lg:text-xl">
                  {lead}
                </p>
              )}
              {actions && <div className="mt-7 flex flex-wrap items-center gap-3">{actions}</div>}
              {stats && stats.length > 0 && (
                <dl className="mt-9 grid grid-cols-2 gap-y-5 border-t border-white/10 pt-6 sm:flex sm:flex-wrap sm:gap-x-10 sm:gap-y-0">
                  {stats.map((stat) => (
                    <div key={stat.label} className="flex flex-col-reverse">
                      <dt className="font-mono-kicker mt-1 text-[10px] uppercase tracking-[0.1em] text-white/55">
                        {stat.label}
                      </dt>
                      <dd className="font-serif-display text-[26px] font-semibold leading-none text-white">
                        {stat.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        </section>
      );
    }

    // Default variant — light bg, gold kicker, navy type. Suitable for
    // in-page editorial heroes such as /my-events.
    return (
      <section ref={ref} className={cn("mx-auto max-w-6xl", className)} {...rest}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[760px]">
            {kicker && (
              <p className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.16em] text-teranga-gold-dark">
                {kicker}
              </p>
            )}
            {pills && <div className="mt-3 flex flex-wrap gap-2">{pills}</div>}
            <h1 className={cn("font-serif-display mt-3 text-balance text-foreground", titleClass)}>
              {title}
            </h1>
            {lead && (
              <p className="mt-4 max-w-[640px] text-base leading-relaxed text-muted-foreground sm:text-lg text-pretty">
                {lead}
              </p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        {stats && stats.length > 0 && (
          <dl className="mt-9 grid grid-cols-2 gap-y-5 border-t pt-6 sm:flex sm:flex-wrap sm:gap-x-10 sm:gap-y-0">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse">
                <dt className="font-mono-kicker mt-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  {stat.label}
                </dt>
                <dd className="font-serif-display text-[26px] font-semibold leading-none text-foreground">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    );
  },
);
EditorialHero.displayName = "EditorialHero";

export { EditorialHero };
