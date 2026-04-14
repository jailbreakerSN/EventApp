import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "../lib/utils";

type FormFieldState = "idle" | "valid" | "error";

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  /**
   * Explicit visual state. Callers using onBlur validation can pass
   * "valid" once the field clears validation to surface a green
   * checkmark — frontend-design: *never leave the user guessing*.
   * When `error` is set, state is forced to "error" regardless.
   */
  state?: FormFieldState;
  className?: string;
  children: React.ReactNode;
}

function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  state,
  className,
  children,
}: FormFieldProps) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const describedBy = [error && errorId, hint && !error && hintId].filter(Boolean).join(" ") || undefined;

  // `error` string always wins; otherwise honour the caller-supplied state.
  const resolvedState: FormFieldState = error ? "error" : (state ?? "idle");

  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-foreground"
      >
        {label}
        {required && <span className="text-destructive ml-0.5" aria-hidden="true">*</span>}
      </label>

      {/* Clone child to inject aria-describedby and a valid-indicator wrapper. */}
      <div className="relative">
        {describedBy || resolvedState === "valid" ? (
          React.isValidElement(children)
            ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
                "aria-describedby": describedBy,
                "aria-invalid": error ? true : undefined,
                className: cn(
                  (children.props as { className?: string }).className,
                  resolvedState === "valid" && "pr-9",
                ),
              })
            : children
        ) : (
          children
        )}

        {resolvedState === "valid" && (
          <Check
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-teranga-green"
          />
        )}
      </div>

      {error && (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export { FormField, type FormFieldProps, type FormFieldState };
