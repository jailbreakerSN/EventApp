"use client";

/**
 * Organizer overhaul — Phase O5.
 *
 * Horizontal gantt-style timeline of every comm scheduled / sent for
 * an event. Pure SVG — same "no external chart library" stance as
 * the Phase O3 PacingChart.
 *
 * Visual contract:
 *  - X axis spans the data range (rangeStart → rangeEnd) with a
 *    minimum 7-day window so a single broadcast doesn't get a
 *    1-second axis.
 *  - One row per channel (email / sms / push / in_app), color-coded
 *    via the CHANNEL_COLOR map.
 *  - Each entry is a rounded marker positioned on the row at its
 *    `at` timestamp. Status drives the fill: scheduled = light,
 *    sent = solid, failed = red border, sending = pulsing dashed.
 *  - Today is shown as a vertical "Aujourd'hui" line.
 *  - Empty state ("Pas encore de communications planifiées") below
 *    n=0; loading state via a skeleton-like shimmer above.
 *
 * Pure path-builders (`buildTimelineGeometry`) are exported so
 * geometry pinning is decoupled from the JSX layer.
 */

import { useMemo } from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommsTimelineEntry, CommsTimelineResponse } from "@/hooks/use-comms-timeline";
import type { CommunicationChannel } from "@teranga/shared-types";

// Phase O6 — `whatsapp` joins the row set. Order = top-to-bottom row
// in the gantt; we keep email at the top (highest broadcast volume),
// then push (mobile), sms, whatsapp (Senegal-dominant), then in_app
// (lowest engagement — bottom of the visual stack).
const CHANNELS: readonly CommunicationChannel[] = ["email", "push", "sms", "whatsapp", "in_app"];

const CHANNEL_LABEL: Record<CommunicationChannel, string> = {
  email: "Email",
  push: "Push",
  sms: "SMS",
  whatsapp: "WhatsApp",
  in_app: "In-app",
};

const CHANNEL_COLOR: Record<CommunicationChannel, { stroke: string; fill: string }> = {
  email: { stroke: "stroke-sky-500", fill: "fill-sky-500" },
  push: { stroke: "stroke-violet-500", fill: "fill-violet-500" },
  sms: { stroke: "stroke-emerald-500", fill: "fill-emerald-500" },
  // Meta WhatsApp brand green is `#25D366`. Tailwind doesn't ship it,
  // so we lean on `green-500` which reads close enough at the marker
  // size and stays distinct from the SMS emerald row.
  whatsapp: { stroke: "stroke-green-500", fill: "fill-green-500" },
  in_app: { stroke: "stroke-amber-500", fill: "fill-amber-500" },
};

const ROW_HEIGHT = 36;
const PADDING = { top: 24, right: 16, bottom: 32, left: 70 };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MIN_WINDOW_DAYS = 7;

export interface CommsTimelineProps {
  data: CommsTimelineResponse | undefined;
  width?: number;
  /** Render-mode override — used by tests. Defaults to `now()`. */
  now?: Date;
  className?: string;
}

interface PositionedEntry {
  entry: CommsTimelineEntry;
  cx: number;
  cy: number;
}

export interface TimelineGeometry {
  positioned: PositionedEntry[];
  windowStartMs: number;
  windowEndMs: number;
  innerWidth: number;
  height: number;
  rowOf: Record<CommunicationChannel, number>;
  todayX: number | null;
}

/**
 * Pure helper: place each entry on the chart, compute the X axis
 * window, and the Y row per channel. Exported for unit tests.
 */
export function buildTimelineGeometry(args: {
  entries: readonly CommsTimelineEntry[];
  rangeStart: string | null;
  rangeEnd: string | null;
  width: number;
  now: Date;
}): TimelineGeometry {
  const { entries, rangeStart, rangeEnd, width, now } = args;

  const innerWidth = Math.max(0, width - PADDING.left - PADDING.right);
  const height = PADDING.top + ROW_HEIGHT * CHANNELS.length + PADDING.bottom;

  const rowOf: Record<CommunicationChannel, number> = {
    email: PADDING.top + ROW_HEIGHT * 0 + ROW_HEIGHT / 2,
    push: PADDING.top + ROW_HEIGHT * 1 + ROW_HEIGHT / 2,
    sms: PADDING.top + ROW_HEIGHT * 2 + ROW_HEIGHT / 2,
    whatsapp: PADDING.top + ROW_HEIGHT * 3 + ROW_HEIGHT / 2,
    in_app: PADDING.top + ROW_HEIGHT * 4 + ROW_HEIGHT / 2,
  };

  if (entries.length === 0 || !rangeStart || !rangeEnd) {
    return {
      positioned: [],
      windowStartMs: now.getTime(),
      windowEndMs: now.getTime() + MIN_WINDOW_DAYS * ONE_DAY_MS,
      innerWidth,
      height,
      rowOf,
      todayX: null,
    };
  }

  let startMs = new Date(rangeStart).getTime();
  let endMs = new Date(rangeEnd).getTime();

  // Always include "now" in the window so the today-marker is visible.
  startMs = Math.min(startMs, now.getTime());
  endMs = Math.max(endMs, now.getTime());

  const spanMs = endMs - startMs;
  if (spanMs < MIN_WINDOW_DAYS * ONE_DAY_MS) {
    // Pad the window symmetrically up to MIN_WINDOW_DAYS so a single
    // broadcast doesn't degenerate the X axis to a point.
    const extra = MIN_WINDOW_DAYS * ONE_DAY_MS - spanMs;
    startMs -= extra / 2;
    endMs += extra / 2;
  }

  const totalSpan = endMs - startMs;
  const xOf = (iso: string): number => {
    const t = (new Date(iso).getTime() - startMs) / totalSpan;
    return PADDING.left + Math.max(0, Math.min(1, t)) * innerWidth;
  };

  const positioned = entries.map<PositionedEntry>((entry) => ({
    entry,
    cx: xOf(entry.at),
    cy: rowOf[entry.channel],
  }));

  const todayWithinWindow = now.getTime() >= startMs && now.getTime() <= endMs;
  const todayX = todayWithinWindow
    ? PADDING.left + ((now.getTime() - startMs) / totalSpan) * innerWidth
    : null;

  return {
    positioned,
    windowStartMs: startMs,
    windowEndMs: endMs,
    innerWidth,
    height,
    rowOf,
    todayX,
  };
}

export function CommsTimeline({ data, width = 720, now, className }: CommsTimelineProps) {
  const renderNow = useMemo(() => now ?? new Date(), [now]);
  const geometry = useMemo(
    () =>
      buildTimelineGeometry({
        entries: data?.entries ?? [],
        rangeStart: data?.rangeStart ?? null,
        rangeEnd: data?.rangeEnd ?? null,
        width,
        now: renderNow,
      }),
    [data, width, renderNow],
  );

  if (!data) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-xs text-muted-foreground",
          className,
        )}
        style={{ width, height: 200 }}
      >
        Chargement…
      </div>
    );
  }

  if (data.entries.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 p-8 text-center text-xs text-muted-foreground",
          className,
        )}
        style={{ width }}
      >
        <Calendar className="h-6 w-6 opacity-50" aria-hidden="true" />
        Pas encore de communications planifiées pour cet événement.
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={geometry.height}
      viewBox={`0 0 ${width} ${geometry.height}`}
      role="img"
      aria-label="Frise horizontale des communications planifiées et envoyées par canal"
      className={cn("font-mono", className)}
    >
      <title>Frise des communications</title>

      {/* Channel rows + labels */}
      {CHANNELS.map((ch) => {
        const cy = geometry.rowOf[ch];
        return (
          <g key={ch}>
            <line
              x1={PADDING.left}
              x2={PADDING.left + geometry.innerWidth}
              y1={cy}
              y2={cy}
              className="stroke-border/60"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
            <text
              x={PADDING.left - 8}
              y={cy + 3}
              textAnchor="end"
              className="fill-muted-foreground"
              style={{ fontSize: 10 }}
            >
              {CHANNEL_LABEL[ch]}
            </text>
          </g>
        );
      })}

      {/* Today vertical line */}
      {geometry.todayX !== null && (
        <g>
          <line
            x1={geometry.todayX}
            x2={geometry.todayX}
            y1={PADDING.top - 6}
            y2={geometry.height - PADDING.bottom + 6}
            className="stroke-teranga-gold/80"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
          <text
            x={geometry.todayX}
            y={PADDING.top - 8}
            textAnchor="middle"
            className="fill-teranga-gold"
            style={{ fontSize: 9 }}
          >
            Aujourd&apos;hui
          </text>
        </g>
      )}

      {/* X-axis range labels */}
      <g>
        <text
          x={PADDING.left}
          y={geometry.height - 8}
          textAnchor="start"
          className="fill-muted-foreground"
          style={{ fontSize: 9 }}
        >
          {formatShortDate(new Date(geometry.windowStartMs))}
        </text>
        <text
          x={PADDING.left + geometry.innerWidth}
          y={geometry.height - 8}
          textAnchor="end"
          className="fill-muted-foreground"
          style={{ fontSize: 9 }}
        >
          {formatShortDate(new Date(geometry.windowEndMs))}
        </text>
      </g>

      {/* Entry markers */}
      {geometry.positioned.map(({ entry, cx, cy }) => {
        const color = CHANNEL_COLOR[entry.channel];
        const isFailed = entry.status === "failed";
        const isSent = entry.status === "sent";
        const isScheduled = entry.status === "scheduled";
        return (
          <g key={entry.id}>
            <title>{`${CHANNEL_LABEL[entry.channel]} — ${entry.title} (${entry.status})`}</title>
            <circle
              cx={cx}
              cy={cy}
              r={6}
              className={cn(
                color.stroke,
                isSent ? color.fill : "fill-background",
                isFailed && "stroke-red-500",
              )}
              strokeWidth={isFailed ? 2 : 1.5}
              strokeDasharray={isScheduled ? "2 2" : undefined}
            />
          </g>
        );
      })}
    </svg>
  );
}

function formatShortDate(d: Date): string {
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
  return `${d.getDate()} ${months[d.getMonth()]}`;
}
