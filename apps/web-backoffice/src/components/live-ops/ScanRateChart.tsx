"use client";

/**
 * Organizer overhaul — Phase O8.
 *
 * Sparkline of scan rate (badges scanned per minute) for the last 30
 * minutes. Same "no external chart library" stance as the Phase O3
 * PacingChart and Phase O5 CommsTimeline — pure SVG paths computed
 * from a 30-bucket array.
 *
 * Visual contract:
 *  - Single line (teranga-gold) plotting count per minute.
 *  - Filled area below the line at 25 % opacity for visual weight on
 *    the floor-ops dashboard (operators glance, don't squint).
 *  - Tiny markers on the last bucket only — the "right now" tip.
 *  - Y axis: 0 + max-rounded label, no intermediate ticks (sparkline
 *    is a magnitude-at-a-glance widget, not a precision chart).
 *  - X axis: -30m label on the left, "maintenant" on the right.
 *  - Empty state ("En attente du premier scan") when every bucket is
 *    zero — a fresh event hasn't started scanning yet.
 *
 * Pure path-builder (`buildScanRateGeometry`) is exported for unit
 * tests and to keep the JSX layer trivial.
 */

import { useMemo } from "react";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScanRateBucket {
  /** ISO start of the 1-minute slot. */
  at: string;
  count: number;
}

export interface ScanRateChartProps {
  buckets: ReadonlyArray<ScanRateBucket>;
  width?: number;
  height?: number;
  className?: string;
}

const PADDING = { top: 8, right: 12, bottom: 18, left: 28 };

export interface ScanRateGeometry {
  linePath: string;
  areaPath: string;
  /** Last point coords for the "now" marker. */
  lastPoint: { x: number; y: number } | null;
  yMax: number;
  innerWidth: number;
  innerHeight: number;
  totalCount: number;
}

export function buildScanRateGeometry(args: {
  buckets: ReadonlyArray<ScanRateBucket>;
  width: number;
  height: number;
}): ScanRateGeometry {
  const { buckets, width, height } = args;
  const innerWidth = Math.max(0, width - PADDING.left - PADDING.right);
  const innerHeight = Math.max(0, height - PADDING.top - PADDING.bottom);

  if (buckets.length < 2) {
    return {
      linePath: "",
      areaPath: "",
      lastPoint: null,
      yMax: 0,
      innerWidth,
      innerHeight,
      totalCount: 0,
    };
  }

  const totalCount = buckets.reduce((acc, b) => acc + b.count, 0);
  const rawMax = Math.max(1, ...buckets.map((b) => b.count));
  // Headroom of 25 % so the spike doesn't crash into the chart top
  // (with a minimum of 4 to avoid wild swings on very-low traffic).
  const yMax = Math.max(4, Math.ceil(rawMax * 1.25));

  const xStep = innerWidth / (buckets.length - 1);
  const yOf = (v: number) => PADDING.top + innerHeight - (v / yMax) * innerHeight;

  const points = buckets.map((b, i) => ({
    x: PADDING.left + i * xStep,
    y: yOf(b.count),
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  // Close the area down to the X axis so we can fill the swept region.
  const baseline = (PADDING.top + innerHeight).toFixed(1);
  const areaPath =
    `M${points[0].x.toFixed(1)},${baseline} ` +
    points.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L${points[points.length - 1].x.toFixed(1)},${baseline} Z`;

  const lastPoint = points[points.length - 1];

  return {
    linePath,
    areaPath,
    lastPoint,
    yMax,
    innerWidth,
    innerHeight,
    totalCount,
  };
}

export function ScanRateChart({
  buckets,
  width = 360,
  height = 96,
  className,
}: ScanRateChartProps) {
  const geometry = useMemo(
    () => buildScanRateGeometry({ buckets, width, height }),
    [buckets, width, height],
  );

  if (buckets.length < 2 || geometry.totalCount === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 text-xs text-muted-foreground",
          className,
        )}
        style={{ width, height }}
      >
        <Activity className="h-4 w-4 opacity-60" aria-hidden="true" />
        En attente du premier scan…
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Cadence des scans sur les 30 dernières minutes : ${geometry.totalCount} au total`}
      className={cn("font-mono", className)}
    >
      <title>Cadence des scans — 30 dernières minutes</title>

      {/* Y-axis labels (0 + max) */}
      <text
        x={PADDING.left - 4}
        y={PADDING.top + 4}
        textAnchor="end"
        className="fill-muted-foreground"
        style={{ fontSize: 9 }}
      >
        {geometry.yMax}
      </text>
      <text
        x={PADDING.left - 4}
        y={PADDING.top + geometry.innerHeight}
        textAnchor="end"
        className="fill-muted-foreground"
        style={{ fontSize: 9 }}
      >
        0
      </text>

      {/* Baseline */}
      <line
        x1={PADDING.left}
        x2={PADDING.left + geometry.innerWidth}
        y1={PADDING.top + geometry.innerHeight}
        y2={PADDING.top + geometry.innerHeight}
        className="stroke-border"
        strokeWidth={1}
      />

      {/* Filled area under the curve */}
      <path d={geometry.areaPath} className="fill-teranga-gold/20" stroke="none" />

      {/* Line */}
      <path
        d={geometry.linePath}
        fill="none"
        className="stroke-teranga-gold"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* "Now" marker on the rightmost point */}
      {geometry.lastPoint && (
        <circle
          cx={geometry.lastPoint.x}
          cy={geometry.lastPoint.y}
          r={3}
          className="fill-teranga-gold stroke-background"
          strokeWidth={1.5}
        />
      )}

      {/* X-axis labels */}
      <text
        x={PADDING.left}
        y={height - 4}
        textAnchor="start"
        className="fill-muted-foreground"
        style={{ fontSize: 9 }}
      >
        −30 min
      </text>
      <text
        x={PADDING.left + geometry.innerWidth}
        y={height - 4}
        textAnchor="end"
        className="fill-muted-foreground"
        style={{ fontSize: 9 }}
      >
        maintenant
      </text>
    </svg>
  );
}
