import * as React from "react";
import { cn } from "../lib/utils";

export type StatusPillTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "gold"
  | "clay";

export interface StatusPillProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Tone of the pill — maps to a Teranga brand colour pair. */
  tone: StatusPillTone;
  /** Visible pill label. */
  label: string;
  /**
   * Optional icon node rendered before the label (e.g. `<Check className="h-3 w-3" />`).
   * Consumer owns sizing.
   */
  icon?: React.ReactNode;
}

/**
 * Editorial 6-tone status pill. Used on the My Events dashboard rows and
 * anywhere else a compact status indicator is needed (e.g. ticket header
 * chips). Kept as a *new* export — the existing `Badge` component is left
 * untouched because it is used across both web apps with shadcn-style
 * variants (default/secondary/success/warning/danger/outline).
 *
 * Tone mapping (aligns with the participant app's historical palette):
 * - success → teranga-green      (confirmed, paid)
 * - warning → teranga-gold        (pending, pending_payment, waitlisted, refund_requested)
 * - danger  → destructive         (errors that should alarm — refused, failed)
 * - info    → teranga-navy        (filled navy pill, e.g. checked_in)
 * - neutral → muted               (refunded, archived)
 * - gold    → teranga-gold        (filled bright gold for VIP / ACCÈS VALIDE context)
 * - clay    → teranga-clay        (editorial cancelled / soft-alert, matches the
 *                                  existing my-events cancelled pill)
 *
 * Parent owns i18n — the primitive never guesses labels from status strings.
 */
const TONE_CLASSES: Record<StatusPillTone, string> = {
  success: "bg-teranga-green/10 text-teranga-green border-teranga-green/30",
  warning: "bg-teranga-gold-whisper text-teranga-gold-dark border-teranga-gold/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-teranga-navy text-white border-teranga-navy",
  neutral: "bg-muted text-muted-foreground border-border",
  gold: "bg-teranga-gold text-teranga-navy border-teranga-gold",
  clay: "bg-teranga-clay/10 text-teranga-clay border-teranga-clay/30",
};

const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ tone, label, icon, className, ...rest }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
          TONE_CLASSES[tone],
          className,
        )}
        {...rest}
      >
        {icon}
        {label}
      </span>
    );
  },
);
StatusPill.displayName = "StatusPill";

export { StatusPill };
