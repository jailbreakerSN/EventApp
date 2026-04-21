import * as React from "react";
import { AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { cn } from "../lib/utils";
import type { ErrorSeverity } from "@teranga/shared-types";

export interface InlineErrorBannerAction {
  label: string;
  onClick?: () => void;
  href?: string;
  /** Whether this is the primary action (first one) — defaults to true for the first action. */
  primary?: boolean;
}

export interface InlineErrorBannerProps {
  title: string;
  description?: string;
  /** Kicker text above the title (e.g. "— Impossible de s'inscrire"). Optional. */
  kicker?: string;
  severity?: ErrorSeverity;
  /**
   * 1–3 follow-up actions. `href` renders an `<a>` (no client-side router —
   * the caller is expected to wrap with `Link` if needed); `onClick`
   * renders a `<button>`. The first action is primary unless `primary`
   * is set explicitly.
   */
  actions?: InlineErrorBannerAction[];
  /** Accessible label for the dismiss button. Dismissible when provided. */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}

const TONE_STYLES: Record<ErrorSeverity, string> = {
  destructive:
    "border-destructive/30 bg-destructive/5 text-foreground dark:border-destructive/40 dark:bg-destructive/10",
  warning:
    "border-teranga-clay/30 bg-teranga-clay/5 text-foreground dark:border-teranga-clay/40 dark:bg-teranga-clay/10",
  info: "border-border bg-muted/40 text-foreground",
};

const ICON_STYLES: Record<ErrorSeverity, string> = {
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-teranga-clay/15 text-teranga-clay-dark",
  info: "bg-muted text-muted-foreground",
};

const KICKER_STYLES: Record<ErrorSeverity, string> = {
  destructive: "text-destructive",
  warning: "text-teranga-clay-dark",
  info: "text-muted-foreground",
};

const ICON: Record<ErrorSeverity, typeof AlertTriangle> = {
  destructive: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

/**
 * Persistent, accessible error feedback for blocking failures — the
 * opposite of a transient toast. Renders `role="alert"` so screen readers
 * announce it, `aria-live="assertive"` for destructive tone (user must
 * act), `polite` otherwise.
 *
 * Use whenever a submission or action fails in a way the user can fix
 * (wrong input, wrong state, closed window). For successful confirmations
 * keep using the `Toaster`.
 *
 * See `docs/design-system/error-handling.md` for when to choose this
 * over a toast, a field-level error, or a page-level blocking state.
 */
export function InlineErrorBanner({
  title,
  description,
  kicker,
  severity = "destructive",
  actions,
  onDismiss,
  dismissLabel,
  className,
}: InlineErrorBannerProps) {
  const Icon = ICON[severity];
  const live = severity === "destructive" ? "assertive" : "polite";
  return (
    <div
      role="alert"
      aria-live={live}
      className={cn("rounded-card border p-4", TONE_STYLES[severity], className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
            ICON_STYLES[severity],
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          {kicker && (
            <p
              className={cn(
                "font-mono-kicker text-[10px] font-medium uppercase tracking-[0.14em]",
                KICKER_STYLES[severity],
              )}
            >
              {kicker}
            </p>
          )}
          <p className={cn("text-sm font-semibold", kicker && "mt-1")}>{title}</p>
          {description && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel ?? "Fermer"}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {actions && actions.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {actions.map((action, i) => {
            const isPrimary = action.primary ?? i === 0;
            const classes = cn(
              "inline-flex h-10 flex-1 items-center justify-center rounded-full px-4 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold",
              isPrimary
                ? "bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
                : "border text-foreground hover:bg-muted",
            );
            return action.href ? (
              <a key={action.label} href={action.href} className={classes}>
                {action.label}
              </a>
            ) : (
              <button key={action.label} type="button" onClick={action.onClick} className={classes}>
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
