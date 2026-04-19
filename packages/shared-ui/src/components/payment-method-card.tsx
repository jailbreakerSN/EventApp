import * as React from "react";
import { cn } from "../lib/utils";

export interface PaymentMethodCardProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Short glyph drawn on the 44px colored tile (e.g. "W", "OM", "F", "CB"). */
  glyph: string;
  /** Accent color of the glyph tile (the brand colour is confined to the tile). */
  accent: string;
  /** Payment method display name (e.g. "Wave"). */
  name: string;
  /** Short descriptive caption under the name. */
  description: string;
  /** Radio selection state — caller owns the selection group. */
  selected: boolean;
}

/**
 * Editorial payment-method radio card: 44px colored glyph tile on the left,
 * name + description in the middle, radio indicator on the right.
 * Used in the registration payment step for Wave / OM / Free Money / Card.
 *
 * This is a single radio option — the parent renders the radiogroup and owns
 * the onClick handler + selected state. The component renders a `<button
 * role="radio">` with aria-checked, matching the original inline markup.
 */
const PaymentMethodCard = React.forwardRef<HTMLButtonElement, PaymentMethodCardProps>(
  ({ glyph, accent, name, description, selected, className, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={selected}
        className={cn(
          "flex items-center gap-4 rounded-card border p-4 text-left transition-all",
          selected
            ? "border-2 border-teranga-navy bg-muted/40"
            : "border hover:border-foreground/30",
          className,
        )}
        {...rest}
      >
        <span
          aria-hidden="true"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] text-sm font-bold text-white"
          style={{ backgroundColor: accent }}
        >
          {glyph}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{name}</span>
          <span className="block text-xs text-muted-foreground">{description}</span>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "h-5 w-5 flex-shrink-0 rounded-full transition-all",
            selected ? "border-[6px] border-teranga-navy" : "border-2 border-border",
          )}
        />
      </button>
    );
  },
);
PaymentMethodCard.displayName = "PaymentMethodCard";

export { PaymentMethodCard };
