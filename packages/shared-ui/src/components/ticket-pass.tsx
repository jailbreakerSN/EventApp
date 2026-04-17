import * as React from "react";
import { cn } from "../lib/utils";

// Eight editorial gradient palettes mirrored from the participant app's
// cover-gradient util. Kept inline here so shared-ui has no app imports.
// Must stay in sync with apps/web-participant/src/lib/cover-gradient.ts.
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

function getCoverTint(key: string): string {
  return COVER_GRADIENTS[hashKey(key) % COVER_GRADIENTS.length].tint;
}

export interface TicketPassField {
  label: string;
  value: string;
}

export interface TicketPassProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Stable key for the gradient tint (typically the eventId). */
  coverKey: string;
  /** Mono kicker at the top of the header (e.g. "Admit One · Pass Nominatif"). */
  kicker: string;
  /** Event title rendered in the gradient header. */
  eventTitle: string;
  /** 2–4 short fields printed under the title (date / pass type / zone etc.). */
  fields: TicketPassField[];
  /** The QR node to place in the footer. Consumer owns rendering (e.g. QRCodeSVG). */
  qr: React.ReactNode;
  /** Primary code string shown below / beside the QR (mono, truncated by caller if needed). */
  codeLabel: string;
  /** Code value (mono). */
  codeValue: string;
  /** Optional secondary info line (e.g. "Name · Ticket type"). */
  holderLine?: string;
  /** Gold pill label (e.g. "ACCÈS VALIDE"). */
  validAccessLabel: string;
  /** Optional footer hint displayed below the QR (e.g. "Scannez pour check-in"). */
  scanHint?: string;
  /** Optional offline reassurance shown as a thin footer strip (e.g. "⚡ Fonctionne hors ligne"). */
  offlineHint?: string;
  /**
   * Layout variant:
   * - "stack" (default): footer stacks QR on top, fields below — matches /my-events/[id]/badge.
   * - "inline": footer puts QR inline with code column on the right — matches /register/success.
   */
  footerVariant?: "stack" | "inline";
  /** When true, run the reveal animation (translateY + opacity) on mount. Respects prefers-reduced-motion via CSS. */
  animateReveal?: boolean;
}

/**
 * Navy editorial ticket pass used in:
 * - /register/[eventId] Step 3 (success flow) — with inline footer.
 * - /my-events/[registrationId]/badge — with stacked footer + offline hint.
 *
 * Gradient-tint header keyed on `coverKey` (same 8-palette rotation as the
 * event cards), perforation notches, QR slot injected via `qr`, gold
 * "ACCÈS VALIDE" pill. The reveal animation is gated behind `animateReveal`
 * and relies on a small inline style — respects prefers-reduced-motion at
 * the CSS layer.
 */
const TicketPass = React.forwardRef<HTMLDivElement, TicketPassProps>(
  (
    {
      coverKey,
      kicker,
      eventTitle,
      fields,
      qr,
      codeLabel,
      codeValue,
      holderLine,
      validAccessLabel,
      scanHint,
      offlineHint,
      footerVariant = "stack",
      animateReveal = false,
      className,
      ...rest
    },
    ref,
  ) => {
    const [revealed, setRevealed] = React.useState(!animateReveal);

    React.useEffect(() => {
      if (!animateReveal) return;
      const timeout = window.setTimeout(() => setRevealed(true), 150);
      return () => window.clearTimeout(timeout);
    }, [animateReveal]);

    const tint = getCoverTint(coverKey);

    return (
      <div
        ref={ref}
        className={cn(
          "overflow-hidden rounded-pass bg-teranga-navy text-white shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)] transition-all duration-500",
          className,
        )}
        style={
          animateReveal
            ? {
                transform: revealed ? "translateY(0) scale(1)" : "translateY(16px) scale(0.98)",
                opacity: revealed ? 1 : 0,
              }
            : undefined
        }
        {...rest}
      >
        {/* Gradient header — tint is event-specific via the 8-palette rotation. */}
        <div
          className="relative px-7 pb-5 pt-7"
          style={{
            background: `linear-gradient(135deg, ${tint} 0%, #1A1A2E 120%)`,
            borderBottom: "1px dashed rgba(255,255,255,.25)",
          }}
        >
          <p className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.18em] text-white/85">
            {kicker}
          </p>
          <p className="font-serif-display mt-4 text-balance text-[26px] font-semibold leading-[1.05] tracking-[-0.02em]">
            {eventTitle}
          </p>
          <div className="mt-5 flex gap-6 text-left">
            {fields.map((f) => (
              <div key={f.label}>
                <p className="font-mono-kicker text-[9px] font-medium uppercase tracking-[0.12em] text-white/60">
                  {f.label}
                </p>
                <p className="mt-1 text-[13px] font-semibold">{f.value}</p>
              </div>
            ))}
          </div>
          <span
            aria-hidden="true"
            className="absolute -bottom-2.5 -left-2.5 h-5 w-5 rounded-full bg-background"
          />
          <span
            aria-hidden="true"
            className="absolute -bottom-2.5 -right-2.5 h-5 w-5 rounded-full bg-background"
          />
        </div>

        {/* Footer: stack (default) vs inline (register success). */}
        {footerVariant === "inline" ? (
          <div className="flex items-center gap-4 p-6">
            <span className="rounded-[10px] bg-white p-2">{qr}</span>
            <div className="min-w-0 flex-1 text-left">
              <p className="font-mono-kicker text-[9px] font-medium uppercase tracking-[0.12em] text-white/60">
                {codeLabel}
              </p>
              <p className="font-mono-kicker mt-1 truncate text-[13px] font-semibold tracking-[0.04em]">
                {codeValue}
              </p>
              <span className="mt-3.5 inline-flex items-center rounded-full bg-teranga-gold px-2 py-0.5 text-[10px] font-bold tracking-[0.04em] text-teranga-navy">
                {validAccessLabel}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center px-6 py-7">
            <div className="rounded-[14px] bg-white p-2.5">{qr}</div>
            <p className="font-mono-kicker mt-5 text-[11px] tracking-[0.1em] text-white/60">
              {codeValue}
            </p>
            {holderLine && <p className="mt-2 text-[13px] text-white/80">{holderLine}</p>}
            <span className="mt-5 inline-flex items-center rounded-full bg-teranga-gold px-2.5 py-0.5 text-[10px] font-bold tracking-[0.04em] text-teranga-navy">
              {validAccessLabel}
            </span>
            {scanHint && <p className="mt-5 text-center text-[11px] text-white/60">{scanHint}</p>}
          </div>
        )}

        {/* Offline hint strip — optional. */}
        {offlineHint && (
          <div className="border-t border-white/10 bg-white/[0.02] px-6 py-3.5 text-center text-[11px] text-white/60">
            {offlineHint}
          </div>
        )}
      </div>
    );
  },
);
TicketPass.displayName = "TicketPass";

export { TicketPass };
