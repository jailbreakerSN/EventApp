import * as React from "react";
import { cn, formatCurrency, formatDate } from "../lib/utils";

// Eight editorial gradient palettes mirrored from the participant app's
// cover-gradient util. Kept inline here so shared-ui has no app imports.
// Both packages need to stay in sync with apps/web-participant/src/lib/cover-gradient.ts.
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

function getCoverGradient(key: string): (typeof COVER_GRADIENTS)[number] {
  return COVER_GRADIENTS[hashKey(key) % COVER_GRADIENTS.length];
}

export interface OrderSummaryLabels {
  /** Mono kicker at the top of the body (e.g. "Récapitulatif"). */
  kicker: string;
  /** Service-fees row label (e.g. "Frais de service"). */
  serviceFees: string;
  /** Value to render in the service-fees column (e.g. "Inclus"). */
  serviceFeesValue: string;
  /** Discount row label (only rendered when discount > 0). */
  discount: string;
  /** Total row label. */
  total: string;
  /** Value rendered when the total/item price is 0 (e.g. "Gratuit"). */
  free: string;
}

export interface OrderSummaryProps extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  /** Stable key driving the fallback gradient (typically the eventId). */
  coverKey: string;
  /** Optional explicit cover image URL. When set, overrides the gradient. */
  coverImageURL?: string | null;
  /** Event start date as ISO string. Rendered as a mono kicker in the header. */
  eventStartDate: string;
  /** Event title rendered on top of the header cover. */
  eventTitle: string;
  /** Ticket type name shown as the first line-item. */
  ticketName: string;
  /** Pre-discount subtotal. Passed as a number, formatted internally. */
  subtotal: number;
  /** Discount amount (0 or omitted = no discount row). */
  discount?: number;
  /** Grand total after discount. */
  total: number;
  /** ISO-4217 currency code. Defaults to "XOF". */
  currency?: string;
  /** BCP-47 locale for formatting (e.g. "fr-SN"). Defaults to "fr-SN". */
  locale?: string;
  /** Optional refund-policy microcopy shown below the total. */
  refundNote?: string;
  /** i18n labels. */
  labels: OrderSummaryLabels;
}

/**
 * Editorial sticky order summary used in the registration Payment step.
 * Top band: 120px gradient cover with mono date kicker + Fraunces title overlay.
 * Body: line items (ticket, optional discount in green, service fees, total)
 * plus optional refund microcopy.
 *
 * The component is intentionally *not* sticky — sticky positioning depends on the
 * scroll container. Wrap it in `<aside class="lg:sticky lg:top-24 lg:self-start">`
 * at the call site when you want the sticky behaviour.
 */
const OrderSummary = React.forwardRef<HTMLElement, OrderSummaryProps>(
  (
    {
      coverKey,
      coverImageURL,
      eventStartDate,
      eventTitle,
      ticketName,
      subtotal,
      discount = 0,
      total,
      currency = "XOF",
      locale = "fr-SN",
      refundNote,
      labels,
      className,
      ...rest
    },
    ref,
  ) => {
    const gradient = getCoverGradient(coverKey);
    const background = coverImageURL
      ? `url(${coverImageURL}) center/cover`
      : gradient.bg;

    const fmtItem = (value: number) =>
      value === 0 ? labels.free : formatCurrency(value, currency, locale);
    const fmtTotal = fmtItem(total);

    return (
      <section
        ref={ref}
        aria-label={labels.kicker}
        className={cn("overflow-hidden rounded-tile border bg-card", className)}
        {...rest}
      >
        {/* Cover thumb: 120px gradient fallback + mono kicker + serif title. */}
        <div
          aria-hidden="true"
          className="teranga-cover relative h-[120px] w-full"
          style={{ background }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"
          />
          <div className="absolute bottom-3.5 left-4 right-4 text-white">
            <p className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.12em] opacity-85">
              {formatDate(eventStartDate, locale)}
            </p>
            <p className="font-serif-display mt-1 line-clamp-2 text-[18px] font-semibold leading-[1.15]">
              {eventTitle}
            </p>
          </div>
        </div>

        <div className="p-5">
          <p className="font-mono-kicker mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {labels.kicker}
          </p>
          <SummaryRow label={ticketName} value={fmtItem(subtotal)} />
          {discount > 0 && (
            <SummaryRow
              label={labels.discount}
              value={`−${formatCurrency(discount, currency, locale)}`}
              tone="discount"
            />
          )}
          <SummaryRow
            label={labels.serviceFees}
            value={labels.serviceFeesValue}
            tone="muted"
          />
          <div className="my-3.5 h-px bg-border" />
          <SummaryRow label={labels.total} value={fmtTotal} tone="total" />
          {refundNote && (
            <p className="mt-3.5 text-[11px] leading-relaxed text-muted-foreground">
              {refundNote}
            </p>
          )}
        </div>
      </section>
    );
  },
);
OrderSummary.displayName = "OrderSummary";

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "muted" | "discount" | "total";
}) {
  const toneClasses =
    tone === "muted"
      ? "text-muted-foreground"
      : tone === "discount"
        ? "text-teranga-green"
        : tone === "total"
          ? "text-foreground font-bold text-[16px]"
          : "text-foreground";
  return (
    <div
      className={cn(
        "flex items-center justify-between py-1.5 text-sm font-medium tabular-nums",
        toneClasses,
      )}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export { OrderSummary };
