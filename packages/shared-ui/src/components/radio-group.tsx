"use client";

import * as React from "react";
import { cn } from "../lib/utils";

export interface RadioOption {
  value: string;
  label: string;
}

export interface RadioGroupProps extends Omit<
  React.HTMLAttributes<HTMLFieldSetElement>,
  "onChange"
> {
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  name: string;
  orientation?: "horizontal" | "vertical";
  disabled?: boolean;
}

function RadioGroup({
  options,
  value,
  onChange,
  name,
  orientation = "vertical",
  disabled = false,
  className,
  ...props
}: RadioGroupProps) {
  return (
    <fieldset
      className={cn(
        "flex gap-3",
        orientation === "vertical" ? "flex-col" : "flex-row flex-wrap",
        className,
      )}
      disabled={disabled}
      {...props}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "inline-flex items-center gap-2 cursor-pointer text-sm font-medium text-foreground",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <span className="relative flex items-center justify-center">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange?.(option.value)}
              disabled={disabled}
              className="peer sr-only"
            />
            <span
              className={cn(
                "h-4 w-4 rounded-full border border-input transition-colors",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                value === option.value && "border-primary",
              )}
            />
            {value === option.value && (
              <span className="absolute h-2.5 w-2.5 rounded-full bg-primary" />
            )}
          </span>
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
RadioGroup.displayName = "RadioGroup";

export { RadioGroup };
