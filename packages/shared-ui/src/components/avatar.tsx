"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const avatarVariants = cva(
  "relative inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground font-medium overflow-hidden shrink-0",
  {
    variants: {
      size: {
        sm: "h-8 w-8 text-xs",
        md: "h-10 w-10 text-sm",
        lg: "h-14 w-14 text-lg",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export interface AvatarProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof avatarVariants> {
  src?: string;
  alt?: string;
  fallback?: string;
}

function Avatar({ src, alt, fallback, size, className, ...props }: AvatarProps) {
  const [imgError, setImgError] = React.useState(false);

  const showImage = src && !imgError;

  return (
    <div className={cn(avatarVariants({ size, className }))} {...props}>
      {showImage ? (
        <img
          src={src}
          alt={alt || ""}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span aria-hidden="true">{fallback || (alt ? alt.charAt(0).toUpperCase() : "?")}</span>
      )}
    </div>
  );
}
Avatar.displayName = "Avatar";

export { Avatar, avatarVariants };
