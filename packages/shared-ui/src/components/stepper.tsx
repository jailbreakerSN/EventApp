import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "../lib/utils";

export interface StepperStep {
  /** Short label rendered next to each circle (hidden on mobile). */
  label: string;
}

export interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Ordered list of step definitions. */
  steps: StepperStep[];
  /** 1-indexed current step. Values below 1 default to 1, above length default to length. */
  currentStep: number;
  /**
   * Optional mono-kicker formatter, e.g. `(step, total) => \`Étape ${step}/${total}\`.
   * If omitted, the kicker is not rendered. Parent owns i18n.
   */
  kickerFormatter?: (currentStep: number, total: number) => string;
  /** Accessible label for the list of steps. Defaults to "Progress". Parent should localize. */
  ariaLabel?: string;
}

/**
 * Editorial wizard stepper: 28×28 circles with navy ring for active, green
 * check for done, muted for upcoming. Thin connector lines between steps.
 * Optional right-aligned mono "Étape N/total" kicker — caller owns the
 * i18n via `kickerFormatter`.
 */
const Stepper = React.forwardRef<HTMLDivElement, StepperProps>(
  ({ steps, currentStep, kickerFormatter, ariaLabel = "Progress", className, ...rest }, ref) => {
    const total = steps.length;
    const clampedStep = Math.min(Math.max(1, currentStep), total);

    return (
      <div
        ref={ref}
        className={cn("flex flex-wrap items-center gap-3", className)}
        role="group"
        aria-label={ariaLabel}
        {...rest}
      >
        <div className="mx-auto flex items-center gap-2.5">
          {steps.map((step, i) => {
            const n = i + 1;
            const done = clampedStep > n;
            const active = clampedStep === n;
            return (
              <div key={n} className="flex items-center gap-2.5">
                <span
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors",
                    done
                      ? "bg-teranga-green text-white"
                      : active
                        ? "bg-teranga-navy text-white ring-[3px] ring-teranga-navy/20"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
                </span>
                <span
                  className={cn(
                    "hidden text-sm sm:block",
                    active
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                {i < total - 1 && <span aria-hidden="true" className="h-px w-8 bg-border" />}
              </div>
            );
          })}
        </div>
        {kickerFormatter && (
          <span className="font-mono-kicker text-[11px] tracking-[0.1em] text-muted-foreground">
            {kickerFormatter(clampedStep, total)}
          </span>
        )}
      </div>
    );
  },
);
Stepper.displayName = "Stepper";

export { Stepper };
