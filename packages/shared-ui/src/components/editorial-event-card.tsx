import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "../lib/utils";

// Eight editorial gradient palettes mirrored from the participant app's
// cover-gradient util. Kept inline here so shared-ui has no app imports.
// Must stay in sync with apps/web-participant/src/lib/cover-gradient.ts
// and the identical palettes in order-summary.tsx / ticket-pass.tsx.
const COVER_GRADIENTS = [
  { bg: "linear-gradient(135deg, #1A1A2E 0%, #2a473c 55%, #c59e4b 110%)", tint: "#c59e4b" },
  { bg: "linear-gradient(135deg, #c86f4b 0%, #a78336 60%, #172721 100%)", tint: "#c86f4b" },
  { bg: "linear-gradient(135deg, #2a473c 0%, #16213E 60%, #0F9B58 130%)", tint: "#0F9B58" },
  { bg: "linear-gradient(135deg, #c59e4b 0%, #c86f4b 55%, #1A1A2E 100%)", tint: "#c59e4b" },
  { bg: "linear-gradient(135deg, #16213E 0%, #c86f4b 70%, #d1b372 110%)", tint: "#d1b372" },
  { bg: "linear-gradient(135deg, #0F9B58 0%, #2a473c 60%, #1A1A2E 100%)", tint: "#0F9B58" },
  { bg: "linear-gradient(135deg, #1A1A2E 0%, #0F0F1C 100%)", tint: "#c59e4b" },
  { bg: "linear-gradient(135deg, #d1b372 0%, #c59e4b 40%, #a78336 100%)", tint: "#a78336" },
] as const;

function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  }
  return h;
}

function getCoverGradientBg(key: string): string {
  return COVER_GRADIENTS[hashKey(key) % COVER_GRADIENTS.length].bg;
}

/**
 * Shape of a Next.js-compatible Link component. Consumers pass
 * `next/link`'s `Link`; in non-Next environments (Storybook, other hosts)
 * a plain `<a>` is used automatically.
 */
type LinkLikeProps = {
  href: string;
  className?: string;
  "aria-label"?: string;
  children?: React.ReactNode;
};
export type EditorialEventCardLinkComponent = React.ComponentType<LinkLikeProps>;

/**
 * Shape of a Next.js-compatible Image component. Consumers pass
 * `next/image`'s `Image`. The signature only asks for the handful of
 * props this card uses so non-Next hosts can drop in their own
 * `<img>`-like wrapper.
 */
type ImageLikeProps = {
  src: string;
  alt: string;
  fill?: boolean;
  sizes?: string;
  className?: string;
};
export type EditorialEventCardImageComponent = React.ComponentType<ImageLikeProps>;

export interface EditorialEventCardProps {
  /** Deep-link target for the card (e.g. `/events/the-slug`). */
  href: string;
  /**
   * Stable key used to pick one of the 8 fallback gradient palettes when
   * `coverImageUrl` is not set. Typically the event id or slug — the
   * hash is deterministic so the same key always renders with the same
   * gradient across pages and reloads.
   */
  coverKey: string;
  /** Optional cover image URL. When set, rendered via the injected `image` component. */
  coverImageUrl?: string | null;
  /** Category label shown as a mono kicker in the cover (e.g. "Conférence"). */
  categoryLabel: string;
  /**
   * Optional "Plus que X places" style urgency pill replacing the category
   * kicker when set. Parent owns i18n.
   */
  urgencyLabel?: string | null;
  /** 1-based index shown in the cover's "TER · 001/003" counter. */
  index?: number;
  /** Total card count for the counter. Defaults to 1. */
  total?: number;
  /** Pre-formatted event date (e.g. "14 mai 2026"). */
  dateLabel: string;
  /** Optional pre-formatted city / venue short line. */
  cityLabel?: string | null;
  /** Event title (Fraunces serif, 2-line clamp). */
  title: string;
  /** Optional description (2-line clamp). */
  description?: string | null;
  /**
   * Pre-formatted price label. Pass the localized "Gratuit" / "Free" /
   * "Dalxatul" value for free events — the primitive does not format.
   */
  priceLabel: string;
  /**
   * Optional registered/stat secondary line (e.g. "12 inscrits · 80 % rempli").
   * Hidden when null/undefined.
   */
  registeredLabel?: string | null;
  /**
   * ARIA label for the whole card link. Parents typically compose
   * title + date + city + price.
   */
  ariaLabel?: string;
  /**
   * Optional Next.js `Link` component. When not provided the card uses a
   * plain anchor — convenient for Storybook and non-Next hosts.
   */
  linkComponent?: EditorialEventCardLinkComponent;
  /**
   * Optional Next.js `Image` component. When not provided and a
   * `coverImageUrl` is set, the card falls back to a native `<img>`.
   */
  imageComponent?: EditorialEventCardImageComponent;
  /** Additional classes appended to the outer link element. */
  className?: string;
}

/**
 * Editorial variant of the event card, modelled on the Teranga Participant
 * prototype's `EventCard`. Differences from the default card:
 *
 * - Larger cover tile with branded gradient fallback + grain/stripe texture
 * - Serif title, mono date/city row, pre-formatted price + registered stat
 * - Circular arrow button instead of a price badge on the right
 * - Optional urgency pill when capacity is near-full
 *
 * The primitive is intentionally framework-agnostic: callers pass the
 * Next.js `Link` / `Image` components via `linkComponent` / `imageComponent`,
 * and all strings (date, city, price, category, registered line) are
 * expected to arrive pre-localized from the consumer. Shared-ui never
 * guesses locales or plural forms.
 */
function EditorialEventCard({
  href,
  coverKey,
  coverImageUrl,
  categoryLabel,
  urgencyLabel,
  index = 1,
  total = 1,
  dateLabel,
  cityLabel,
  title,
  description,
  priceLabel,
  registeredLabel,
  ariaLabel,
  linkComponent: LinkComponent,
  imageComponent: ImageComponent,
  className,
}: EditorialEventCardProps) {
  const cardClasses = cn(
    "group flex h-full flex-col overflow-hidden rounded-card border bg-card transition-all",
    "hover:-translate-y-0.5 hover:border-border",
    "hover:shadow-[0_22px_50px_-30px_rgba(15,15,28,0.25),0_2px_6px_-2px_rgba(15,15,28,0.06)]",
    className,
  );

  const coverStyle = coverImageUrl ? undefined : { background: getCoverGradientBg(coverKey) };

  const cover = (
    <>
      <div className="teranga-cover relative aspect-[16/10] w-full" style={coverStyle}>
        {coverImageUrl &&
          (ImageComponent ? (
            <ImageComponent
              src={coverImageUrl}
              alt=""
              fill
              className="z-0 object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            <img
              src={coverImageUrl}
              alt=""
              className="absolute inset-0 z-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ))}
        <div className="relative z-10 flex h-full items-start justify-between p-3.5">
          {urgencyLabel ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teranga-clay/95 px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] text-white">
              {urgencyLabel}
            </span>
          ) : (
            <span className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.08em] text-white/90">
              {categoryLabel}
            </span>
          )}
          <span className="font-mono-kicker text-[10px] tracking-[0.1em] text-white/70">
            TER · {String(index).padStart(3, "0")}/{String(total).padStart(3, "0")}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3.5 p-6" aria-hidden="true">
        <div className="flex items-center justify-between">
          <span className="font-mono-kicker text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            {dateLabel}
          </span>
          {cityLabel && (
            <span className="font-mono-kicker text-[11px] text-muted-foreground">{cityLabel}</span>
          )}
        </div>
        <h3 className="font-serif-display line-clamp-2 text-[22px] font-semibold leading-[1.15] tracking-[-0.015em] text-balance">
          {title}
        </h3>
        {description && (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <div>
            <p className="text-[13px] font-semibold text-foreground tabular-nums">{priceLabel}</p>
            {registeredLabel && (
              <p className="mt-0.5 text-xs text-muted-foreground">{registeredLabel}</p>
            )}
          </div>
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-muted/40 text-foreground transition-all group-hover:border-teranga-navy group-hover:bg-teranga-navy group-hover:text-white"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </>
  );

  if (LinkComponent) {
    return (
      <LinkComponent href={href} aria-label={ariaLabel} className={cardClasses}>
        {cover}
      </LinkComponent>
    );
  }
  return (
    <a href={href} aria-label={ariaLabel} className={cardClasses}>
      {cover}
    </a>
  );
}

export { EditorialEventCard };
