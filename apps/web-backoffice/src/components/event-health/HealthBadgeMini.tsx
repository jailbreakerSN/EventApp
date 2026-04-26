"use client";

/**
 * Organizer overhaul — Phase O3.
 *
 * Lightweight health-tier badge for the events list. Computed
 * client-side from (registeredCount, maxAttendees, startDate) — no
 * API call per row. The precise composite score is the event detail
 * page's job; here we trade exactness for scalability (a 50-row
 * events list would otherwise fire 50 parallel /health queries on
 * every visit).
 *
 * Heuristic mapping:
 *   - days_to_event > 14   → "info" (too early to call)
 *   - registered ÷ target ≥ 60 % → "ok"
 *   - 30 % ≤ ratio < 60 %  → "warn"
 *   - ratio < 30 %         → "danger"
 *
 * `target` defaults to `maxAttendees` when set, otherwise 50 (the
 * same fallback `effectiveCapacity` uses on the API).
 */

import { cn } from "@/lib/utils";

const DEFAULT_TARGET = 50;

export type HealthBadgeTier = "info" | "ok" | "warn" | "danger";

export interface HealthBadgeMiniProps {
  registeredCount: number;
  maxAttendees: number | null | undefined;
  startDate: string;
  /** Hide the textual label (used when space is tight). */
  iconOnly?: boolean;
  className?: string;
}

interface ComputedTier {
  tier: HealthBadgeTier;
  label: string;
  /** Daysleft, exposed for tooltips/tests. */
  daysLeft: number;
  ratioPercent: number;
}

export function deriveBadgeTier(args: {
  registeredCount: number;
  maxAttendees: number | null | undefined;
  startDate: string;
  now?: Date;
}): ComputedTier {
  const { registeredCount, maxAttendees, startDate, now = new Date() } = args;
  const target = maxAttendees && maxAttendees > 0 ? maxAttendees : DEFAULT_TARGET;
  const ratio = registeredCount / target;
  const daysLeft = Math.floor(
    (new Date(startDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  );
  const ratioPercent = Math.round(ratio * 100);

  if (daysLeft > 14) {
    return { tier: "info", label: "À venir", daysLeft, ratioPercent };
  }
  if (ratio >= 0.6) {
    return { tier: "ok", label: `${ratioPercent} %`, daysLeft, ratioPercent };
  }
  if (ratio >= 0.3) {
    return { tier: "warn", label: `${ratioPercent} %`, daysLeft, ratioPercent };
  }
  return { tier: "danger", label: `${ratioPercent} %`, daysLeft, ratioPercent };
}

const TIER_STYLES: Record<HealthBadgeTier, { bg: string; text: string; dot: string }> = {
  info: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  ok: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  warn: {
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  danger: {
    bg: "bg-red-50 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
};

export function HealthBadgeMini({
  registeredCount,
  maxAttendees,
  startDate,
  iconOnly = false,
  className,
}: HealthBadgeMiniProps) {
  const computed = deriveBadgeTier({ registeredCount, maxAttendees, startDate });
  const style = TIER_STYLES[computed.tier];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        style.bg,
        style.text,
        className,
      )}
      title={`Inscriptions : ${registeredCount} / ${maxAttendees ?? DEFAULT_TARGET} (${computed.ratioPercent} %) — J-${Math.max(0, computed.daysLeft)}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} aria-hidden="true" />
      {!iconOnly && computed.label}
    </span>
  );
}
