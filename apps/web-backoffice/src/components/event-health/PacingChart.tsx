"use client";

/**
 * Organizer overhaul — Phase O3.
 *
 * Inline SVG line chart that overlays the actual cumulative
 * registration trajectory against the expected curve. No external
 * chart library — pure SVG paths computed from the `pacing` array.
 *
 * Visual contract:
 *  - Two paths plot the same X axis (day index): the actual line is
 *    a solid teranga-gold stroke; the expected line is a dashed
 *    muted-foreground stroke.
 *  - Y axis shows the count, scaled to the max of (max actual, max
 *    expected) plus a 10 % headroom so the line never touches the
 *    chart top.
 *  - X axis labels: first date, midpoint date, today (last date).
 *  - A subtle horizontal grid (3 lines) helps eyeball the values.
 *  - Empty state ("Pas encore assez de données") when fewer than
 *    two points are available.
 *
 * Pure presentational — receives a typed `pacing` array. The
 * computation is the responsibility of the API service.
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface PacingPoint {
  date: string;
  dayIndex: number;
  actual: number;
  expected: number;
}

export interface PacingChartProps {
  pacing: PacingPoint[];
  /** Width of the rendered SVG. Defaults to 480. */
  width?: number;
  /** Height of the rendered SVG. Defaults to 200. */
  height?: number;
  className?: string;
}

const PADDING = { top: 16, right: 16, bottom: 32, left: 36 };

/**
 * Build the two SVG path commands ("M x y L x y …") for a pacing
 * dataset. Exported for unit testing the geometry independently of
 * the JSX layer.
 */
export function buildPacingPaths(args: {
  pacing: ReadonlyArray<PacingPoint>;
  width: number;
  height: number;
}): { actual: string; expected: string; max: number } {
  const { pacing, width, height } = args;
  if (pacing.length < 2) return { actual: "", expected: "", max: 0 };

  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;
  const maxValue = Math.max(1, ...pacing.map((p) => Math.max(p.actual, p.expected)));
  const headroom = Math.ceil(maxValue * 1.1);

  const xStep = innerW / (pacing.length - 1);
  const yScale = (v: number) => PADDING.top + innerH - (v / headroom) * innerH;

  const buildPath = (key: "actual" | "expected"): string =>
    pacing
      .map((p, i) => {
        const x = PADDING.left + i * xStep;
        const y = yScale(p[key]);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return {
    actual: buildPath("actual"),
    expected: buildPath("expected"),
    max: headroom,
  };
}

export function PacingChart({ pacing, width = 480, height = 200, className }: PacingChartProps) {
  const { actualPath, expectedPath, headroom } = useMemo(() => {
    const built = buildPacingPaths({ pacing, width, height });
    return {
      actualPath: built.actual,
      expectedPath: built.expected,
      headroom: built.max,
    };
  }, [pacing, width, height]);

  if (pacing.length < 2) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-xs text-muted-foreground",
          className,
        )}
        style={{ width, height }}
      >
        Pas encore assez de données pour tracer le rythme.
      </div>
    );
  }

  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;
  const xMidIndex = Math.floor((pacing.length - 1) / 2);
  const xLabels: { idx: number; date: string }[] = [
    { idx: 0, date: pacing[0].date },
    { idx: xMidIndex, date: pacing[xMidIndex].date },
    { idx: pacing.length - 1, date: pacing[pacing.length - 1].date },
  ];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Courbe d'inscription : actuelle versus attendue, par jour"
      className={cn("font-mono", className)}
    >
      <title>Courbe d&apos;inscription — actuelle vs attendue</title>

      {/* Background gridlines (3 horizontal). The middle one anchors
          the eye at ~50 % of the headroom. */}
      {[0.25, 0.5, 0.75].map((frac) => {
        const y = PADDING.top + innerH * (1 - frac);
        return (
          <line
            key={frac}
            x1={PADDING.left}
            x2={PADDING.left + innerW}
            y1={y}
            y2={y}
            className="stroke-border/40"
            strokeDasharray="2 4"
            strokeWidth={1}
          />
        );
      })}

      {/* Y-axis labels (3 ticks: 0, mid, max) */}
      {[0, 0.5, 1].map((frac) => {
        const value = Math.round(headroom * frac);
        const y = PADDING.top + innerH * (1 - frac);
        return (
          <text
            key={frac}
            x={PADDING.left - 6}
            y={y + 3}
            textAnchor="end"
            className="fill-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {value}
          </text>
        );
      })}

      {/* X-axis baseline */}
      <line
        x1={PADDING.left}
        x2={PADDING.left + innerW}
        y1={PADDING.top + innerH}
        y2={PADDING.top + innerH}
        className="stroke-border"
        strokeWidth={1}
      />

      {/* Expected line — dashed muted */}
      <path
        d={expectedPath}
        fill="none"
        className="stroke-muted-foreground/70"
        strokeWidth={2}
        strokeDasharray="4 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Actual line — solid teranga-gold */}
      <path
        d={actualPath}
        fill="none"
        className="stroke-teranga-gold"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* X-axis labels (3 dates) */}
      {xLabels.map((lbl) => {
        const x = PADDING.left + (innerW / (pacing.length - 1)) * lbl.idx;
        return (
          <text
            key={lbl.idx}
            x={x}
            y={height - 8}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {formatShortDate(lbl.date)}
          </text>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${PADDING.left}, ${PADDING.top - 6})`}>
        <line
          x1={0}
          x2={14}
          y1={0}
          y2={0}
          className="stroke-teranga-gold"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
        <text x={20} y={3} className="fill-foreground" style={{ fontSize: 10 }}>
          Réel
        </text>
        <line
          x1={56}
          x2={70}
          y1={0}
          y2={0}
          className="stroke-muted-foreground/70"
          strokeWidth={2}
          strokeDasharray="4 4"
          strokeLinecap="round"
        />
        <text x={76} y={3} className="fill-foreground" style={{ fontSize: 10 }}>
          Attendu
        </text>
      </g>
    </svg>
  );
}

/** "2026-04-26" → "26 avr". */
function formatShortDate(iso: string): string {
  // ISO yyyy-mm-dd is already lexicographic — direct slice is faster
  // than parsing a Date. Months are abbreviated to 3 chars FR.
  const months = [
    "janv",
    "févr",
    "mars",
    "avr",
    "mai",
    "juin",
    "juil",
    "août",
    "sept",
    "oct",
    "nov",
    "déc",
  ];
  const [, m, d] = iso.split("-");
  const monthIdx = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  return `${parseInt(d, 10)} ${months[monthIdx]}`;
}
