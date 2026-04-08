"use client";

import { cn } from "../lib/utils";

interface LogoLoaderProps {
  /** Path to the logo icon SVG — must be in the app's public/ folder */
  src: string;
  /** Optional alt text */
  alt?: string;
  /** Size of the logo in pixels (default: 56) */
  size?: number;
  /** Optional label text below the logo */
  label?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Branded full-page loading screen with rotating logo icon.
 * Uses CSS animation (GPU-accelerated transform) for smooth rotation.
 * Respects `prefers-reduced-motion` — falls back to a gentle pulse.
 */
export function LogoLoader({
  src,
  alt = "Chargement",
  size = 56,
  label,
  className,
}: LogoLoaderProps) {
  return (
    <div
      className={cn(
        "flex min-h-screen flex-col items-center justify-center gap-4 bg-background",
        className,
      )}
      role="status"
      aria-label={alt}
    >
      <div className="relative">
        {/* Rotating ring */}
        <div
          className="absolute inset-0 rounded-full border-2 border-muted motion-safe:animate-spin"
          style={{
            width: size + 24,
            height: size + 24,
            top: -12,
            left: -12,
            borderTopColor: "hsl(var(--primary))",
            animationDuration: "1.2s",
          }}
        />
        {/* Logo icon */}
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="motion-safe:animate-pulse"
          style={{
            width: size,
            height: size,
            animationDuration: "2s",
          }}
        />
      </div>
      {label && (
        <p className="mt-2 text-sm text-muted-foreground motion-safe:animate-pulse">
          {label}
        </p>
      )}
    </div>
  );
}
