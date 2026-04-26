"use client";

/**
 * Organizer overhaul — Phase O3.
 *
 * Circular SVG gauge that renders the event health score (0-100). Pure
 * presentational — feed it `score` + `tier` and it draws. No external
 * chart library — a 144 × 144 SVG with a single-arc stroke based on
 * `stroke-dasharray`.
 *
 * Visual contract:
 *  - Outer ring is the gauge track (low contrast).
 *  - Inner ring is the progress arc, coloured by tier:
 *      excellent (≥ 80) → emerald
 *      healthy   (60-79) → sky
 *      at_risk   (40-59) → amber
 *      critical  (< 40)  → red
 *  - Centre prints the score followed by a French tier label.
 *
 * Accessibility:
 *  - `role="img"` + `aria-label="Score de santé : XX/100, tier"`.
 *  - `<title>` element inside the SVG for screen readers + browsers
 *    that show tooltips on hover.
 */

import { cn } from "@/lib/utils";

export type HealthTier = "critical" | "at_risk" | "healthy" | "excellent";

export interface HealthGaugeProps {
  score: number;
  tier: HealthTier;
  /** Pixel size of the rendered SVG (square). Defaults to 144. */
  size?: number;
  /** Hide the centre label (used when embedding next to a custom title). */
  hideLabel?: boolean;
  className?: string;
}

const TIER_COLOR: Record<HealthTier, { stroke: string; text: string; label: string }> = {
  excellent: {
    stroke: "stroke-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    label: "Excellent",
  },
  healthy: {
    stroke: "stroke-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    label: "Bonne santé",
  },
  at_risk: {
    stroke: "stroke-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    label: "Attention",
  },
  critical: {
    stroke: "stroke-red-500",
    text: "text-red-600 dark:text-red-400",
    label: "Critique",
  },
};

export function HealthGauge({
  score,
  tier,
  size = 144,
  hideLabel = false,
  className,
}: HealthGaugeProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const radius = (size - 16) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  // Reserve a 270° arc (75 % of circumference) so the gauge looks like
  // a "speedometer" with a bottom gap rather than a closed ring. This
  // gives the score number more vertical room and visually anchors
  // the reading.
  const arcSpan = circumference * 0.75;
  const progress = (clamped / 100) * arcSpan;
  const tierStyle = TIER_COLOR[tier];

  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Score de santé : ${clamped} sur 100, ${tierStyle.label.toLowerCase()}`}
      >
        <title>{`Score : ${clamped}/100 — ${tierStyle.label}`}</title>
        {/* Track — full 270° arc, low contrast */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={12}
          strokeLinecap="round"
          className="stroke-muted"
          // Rotate so the arc opens at the bottom (-135° to +135°).
          transform={`rotate(135 ${cx} ${cy})`}
          strokeDasharray={`${arcSpan} ${circumference - arcSpan}`}
        />
        {/* Progress arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={12}
          strokeLinecap="round"
          className={tierStyle.stroke}
          transform={`rotate(135 ${cx} ${cy})`}
          strokeDasharray={`${progress} ${circumference - progress}`}
        />
        {/* Centre score */}
        <text
          x={cx}
          y={cy + 6}
          textAnchor="middle"
          className={cn("fill-current font-bold", tierStyle.text)}
          style={{ fontSize: size / 3.2 }}
        >
          {clamped}
        </text>
        {/* "/100" suffix below the big number */}
        <text
          x={cx}
          y={cy + size / 4}
          textAnchor="middle"
          className="fill-current text-muted-foreground"
          style={{ fontSize: size / 11 }}
        >
          / 100
        </text>
      </svg>
      {!hideLabel && (
        <span className={cn("mt-1 text-xs font-medium", tierStyle.text)}>{tierStyle.label}</span>
      )}
    </div>
  );
}
