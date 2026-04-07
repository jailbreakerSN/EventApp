import * as React from "react";
import { cn } from "../lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circle" | "rectangle";
}

function Skeleton({ className, variant = "text", ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "bg-muted motion-safe:animate-pulse",
        variant === "text" && "h-4 w-full rounded-md",
        variant === "circle" && "h-10 w-10 rounded-full",
        variant === "rectangle" && "h-32 w-full rounded-lg",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton, type SkeletonProps };
