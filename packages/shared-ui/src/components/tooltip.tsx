"use client";

import * as React from "react";
import { cn } from "../lib/utils";

export interface TooltipProps extends React.HTMLAttributes<HTMLDivElement> {
  content: string;
  position?: "top" | "bottom" | "left" | "right";
}

const positionClasses: Record<string, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

function Tooltip({ content, position = "top", children, className, ...props }: TooltipProps) {
  return (
    <div className={cn("group relative inline-flex", className)} {...props}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md border border-border",
          "opacity-0 scale-95 transition-all duration-150",
          "group-hover:opacity-100 group-hover:scale-100",
          positionClasses[position],
        )}
      >
        {content}
      </span>
    </div>
  );
}
Tooltip.displayName = "Tooltip";

export { Tooltip };
