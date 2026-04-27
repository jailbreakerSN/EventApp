"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarSearch, MapPin, Clock, X } from "lucide-react";
import { Button } from "@teranga/shared-ui";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string; // ISO 8601
  endDate?: string; // ISO 8601
  status?: string;
  location?: string;
  slug?: string;
  gradient?: string; // CSS background for the dialog cover
  variant?: "mine" | "discovery";
}

export interface CalendarEventAction {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "outline" | "ghost" | "danger";
}

export interface CalendarLabels {
  prevMonth: string;
  nextMonth: string;
  today: string;
  more: string;
  legend: string;
  legendConfirmed: string;
  legendCheckedIn: string;
  legendPending: string;
  legendWaitlisted: string;
  legendDiscovery: string;
  discoveryOn: string;
  discoveryOff: string;
  closeDialog: string;
  noDiscovery?: string;
}

export interface EventCalendarProps {
  events: CalendarEvent[];
  loading?: boolean;
  labels: CalendarLabels;
  /** Return additional CalendarEvent[] (variant="discovery") for the given month. */
  onDiscovery?: (year: number, month: number) => Promise<CalendarEvent[]>;
  /** Return action buttons for a given event when the detail dialog opens. */
  actions?: (event: CalendarEvent) => CalendarEventAction[];
  className?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BORDER: Record<string, string> = {
  confirmed: "border-l-teranga-green bg-teranga-green/5 dark:bg-teranga-green/10",
  checked_in: "border-l-blue-500 bg-blue-50 dark:bg-blue-950/30",
  pending: "border-l-teranga-gold bg-teranga-gold/5 dark:bg-teranga-gold/10",
  pending_payment: "border-l-teranga-gold bg-teranga-gold/5 dark:bg-teranga-gold/10",
  waitlisted: "border-l-teranga-clay bg-teranga-clay/5 dark:bg-teranga-clay/10",
  cancelled: "border-l-muted-foreground bg-muted/30",
  refund_requested: "border-l-teranga-clay bg-teranga-clay/5 dark:bg-teranga-clay/10",
};

const STATUS_DOT: Record<string, string> = {
  confirmed: "bg-teranga-green",
  checked_in: "bg-blue-500",
  pending: "bg-teranga-gold",
  pending_payment: "bg-teranga-gold",
  waitlisted: "bg-teranga-clay",
  cancelled: "bg-muted-foreground",
  refund_requested: "bg-teranga-clay",
};

const DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parses an ISO timestamp to {year, month (0-indexed), day} in Africa/Dakar time. */
function getDakarParts(iso: string): { year: number; month: number; day: number } {
  // en-CA gives YYYY-MM-DD — the only reliably cross-platform locale that does so.
  const str = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Dakar" });
  const [y, m, d] = str.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    timeZone: "Africa/Dakar",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    timeZone: "Africa/Dakar",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── EventChip ────────────────────────────────────────────────────────────────

function EventChip({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const isDiscovery = event.variant === "discovery";
  const borderClass = isDiscovery
    ? "border-l-violet-500 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-900/40"
    : `${STATUS_BORDER[event.status ?? ""] ?? "border-l-muted-foreground bg-muted/30"} text-foreground hover:brightness-95`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={event.title}
      className={`flex w-full items-center gap-1 rounded-sm border-l-2 px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight transition-colors ${borderClass}`}
    >
      <span className="truncate">{event.title}</span>
    </button>
  );
}

// ─── EventDialog ──────────────────────────────────────────────────────────────

function EventDialog({
  event,
  actions,
  closeLabel,
  onClose,
}: {
  event: CalendarEvent | null;
  actions: CalendarEventAction[];
  closeLabel: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (event && !el.open) {
      el.showModal();
    } else if (!event && el.open) {
      el.close();
    }
  }, [event]);

  // Close on backdrop click
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) onClose();
    },
    [onClose],
  );

  // Sync native close (Escape key) back to React state
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handler = () => onClose();
    el.addEventListener("close", handler);
    return () => el.removeEventListener("close", handler);
  }, [onClose]);

  const gradient =
    event?.gradient ?? "linear-gradient(135deg, #1B2A4A 0%, #2D4A7A 50%, #0F9B58 110%)";

  const statusBadge =
    event?.variant === "mine" && event.status ? (STATUS_DOT[event.status] ?? null) : null;

  return (
    <dialog
      ref={dialogRef}
      onClick={handleClick}
      className="m-auto w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      aria-modal="true"
    >
      {/* Cover area */}
      <div className="relative h-36 overflow-hidden" style={{ background: gradient }}>
        {statusBadge && (
          <span
            className={`absolute bottom-3 left-4 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${statusBadge}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white/70" aria-hidden="true" />
            {event?.status}
          </span>
        )}
        {event?.variant === "discovery" && (
          <span className="absolute bottom-3 left-4 inline-flex items-center gap-1 rounded-full bg-violet-500/80 px-2.5 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
            <CalendarSearch className="h-3 w-3" aria-hidden="true" />
            Découverte
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute right-3 top-3 rounded-full bg-black/30 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/50 focus:outline-none focus:ring-2 focus:ring-white/50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="p-6">
        <h2 className="font-serif-display text-xl font-semibold leading-tight tracking-tight">
          {event?.title}
        </h2>

        <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
          {event?.startDate && (
            <div className="flex items-start gap-2">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-teranga-gold" aria-hidden="true" />
              <dd>
                <span className="capitalize">{fmtDate(event.startDate)}</span>
                <span className="mx-1 opacity-50">·</span>
                <span className="font-medium">{fmtTime(event.startDate)}</span>
                {event.endDate && (
                  <>
                    <span className="mx-1">–</span>
                    <span className="font-medium">{fmtTime(event.endDate)}</span>
                  </>
                )}
              </dd>
            </div>
          )}
          {event?.location && (
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teranga-gold" aria-hidden="true" />
              <dd>{event.location}</dd>
            </div>
          )}
        </dl>

        {/* Action buttons */}
        {actions.length > 0 && (
          <div className="mt-5 flex flex-col gap-2">
            {actions.map((action, i) => {
              const isDanger = action.variant === "danger";
              const btnVariant =
                action.variant === "primary"
                  ? undefined
                  : isDanger
                    ? "ghost"
                    : (action.variant ?? "outline");

              const btn = (
                <Button
                  variant={btnVariant as "outline" | "ghost" | undefined}
                  className={`w-full rounded-full${isDanger ? " text-destructive hover:bg-destructive/10 hover:text-destructive" : ""}`}
                  onClick={action.onClick}
                >
                  {action.icon && (
                    <span className="mr-1.5 flex h-4 w-4 items-center" aria-hidden="true">
                      {action.icon}
                    </span>
                  )}
                  {action.label}
                </Button>
              );

              return action.href ? (
                <Link key={i} href={action.href}>
                  {btn}
                </Link>
              ) : (
                <span key={i}>{btn}</span>
              );
            })}
          </div>
        )}
      </div>
    </dialog>
  );
}

// ─── EventCalendar (main) ─────────────────────────────────────────────────────

export function EventCalendar({
  events,
  loading = false,
  labels,
  onDiscovery,
  actions,
  className = "",
}: EventCalendarProps) {
  const today = useMemo(() => {
    const parts = getDakarParts(new Date().toISOString());
    return parts;
  }, []);

  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [discoveryEnabled, setDiscoveryEnabled] = useState(false);
  const [discoveryEvents, setDiscoveryEvents] = useState<CalendarEvent[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);

  // Anchor the label moment at UTC noon mid-month so no timezone shift
  // can push it across a month boundary. The previous shape —
  // `new Date(year, month, 1).toLocaleDateString({ timeZone: "Africa/Dakar" })`
  // — built LOCAL midnight on day 1 and then re-displayed in Dakar tz.
  // For any user east of Dakar (Paris UTC+2 in summer, Casablanca UTC+1),
  // local midnight on April 1 = March 31 22:00 Dakar → label rendered
  // "mars 2026" while the grid + cursor were correctly on April. Users
  // reasonably read the header and concluded every event was shifted by
  // a full month. UTC noon on day 15 is far enough from any boundary
  // that no inhabited timezone can drift it.
  const monthLabel = new Date(Date.UTC(year, month, 15, 12, 0, 0)).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "Africa/Dakar",
  });

  // ── Navigation ──────────────────────────────────────────────────────────────

  function goPrev() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goNext() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  function goToday() {
    setYear(today.year);
    setMonth(today.month);
  }

  // ── Discovery ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!discoveryEnabled || !onDiscovery) {
      setDiscoveryEvents([]);
      return;
    }
    setDiscoveryLoading(true);
    onDiscovery(year, month)
      .then((evts) => setDiscoveryEvents(evts))
      .catch(() => setDiscoveryEvents([]))
      .finally(() => setDiscoveryLoading(false));
  }, [discoveryEnabled, year, month, onDiscovery]);

  // ── Grid construction ───────────────────────────────────────────────────────

  const allEvents = useMemo(() => [...events, ...discoveryEvents], [events, discoveryEvents]);

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    for (const ev of allEvents) {
      if (!ev.startDate) continue;
      const parts = getDakarParts(ev.startDate);
      if (parts.year === year && parts.month === month) {
        map.set(parts.day, [...(map.get(parts.day) ?? []), ev]);
      }
    }
    return map;
  }, [allEvents, year, month]);

  const firstWeekday = new Date(year, month, 1).getDay(); // 0 = Sun
  const leadingBlanks = (firstWeekday + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // ── Event actions ────────────────────────────────────────────────────────────

  const dialogActions = useMemo(
    () => (selectedEvent && actions ? actions(selectedEvent) : []),
    [selectedEvent, actions],
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={`overflow-hidden rounded-card border bg-card ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            aria-label={labels.prevMonth}
            className="rounded-full p-1.5 transition-colors hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>

          <p className="min-w-[160px] text-center font-serif-display text-[15px] font-semibold capitalize tracking-[-0.01em]">
            {loading ? (
              <span className="inline-block h-4 w-32 animate-pulse rounded bg-muted" />
            ) : (
              monthLabel
            )}
          </p>

          <button
            type="button"
            onClick={goNext}
            aria-label={labels.nextMonth}
            className="rounded-full p-1.5 transition-colors hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Today button — only show when not on current month */}
          {(year !== today.year || month !== today.month) && (
            <button
              type="button"
              onClick={goToday}
              className="rounded-full border px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {labels.today}
            </button>
          )}

          {/* Discovery toggle */}
          {onDiscovery && (
            <button
              type="button"
              aria-pressed={discoveryEnabled}
              onClick={() => setDiscoveryEnabled((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                discoveryEnabled
                  ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <CalendarSearch
                className={`h-3.5 w-3.5 ${discoveryLoading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {discoveryEnabled ? labels.discoveryOff : labels.discoveryOn}
            </button>
          )}
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b">
        {DAY_NAMES.map((d) => (
          <div
            key={d}
            className="py-2 text-center font-mono-kicker text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {/* Leading blank cells */}
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div
            key={`blank-${i}`}
            className="min-h-[80px] border-b border-r last:border-r-0 bg-muted/20"
          />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, idx) => {
          const day = idx + 1;
          const col = (leadingBlanks + idx) % 7;
          const isToday = day === today.day && month === today.month && year === today.year;
          const dayEvts = eventsByDay.get(day) ?? [];
          const isLastCol = col === 6;

          return (
            <div
              key={day}
              className={`min-h-[80px] border-b p-1.5 flex flex-col gap-0.5 ${
                isLastCol ? "" : "border-r"
              } ${isToday ? "bg-teranga-gold/5" : ""}`}
            >
              <span
                className={`mb-0.5 inline-flex h-6 w-6 items-center justify-center self-end rounded-full text-xs font-semibold ${
                  isToday
                    ? "bg-teranga-navy text-white dark:bg-teranga-gold dark:text-teranga-navy"
                    : "text-muted-foreground"
                }`}
              >
                {day}
              </span>

              {dayEvts.slice(0, 2).map((ev) => (
                <EventChip key={ev.id} event={ev} onClick={() => setSelectedEvent(ev)} />
              ))}

              {dayEvts.length > 2 && (
                <button
                  type="button"
                  onClick={() => setSelectedEvent(dayEvts[2])}
                  className="px-1.5 text-left text-[10px] text-muted-foreground hover:text-foreground"
                >
                  +{dayEvts.length - 2} {labels.more}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 border-t px-5 py-3">
        <span className="font-mono-kicker text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {labels.legend}
        </span>
        {(
          [
            { dot: "bg-teranga-green", label: labels.legendConfirmed },
            { dot: "bg-blue-500", label: labels.legendCheckedIn },
            { dot: "bg-teranga-gold", label: labels.legendPending },
            { dot: "bg-teranga-clay", label: labels.legendWaitlisted },
          ] as const
        ).map(({ dot, label }) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
            {label}
          </span>
        ))}
        {discoveryEnabled && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden="true" />
            {labels.legendDiscovery}
          </span>
        )}
      </div>

      {/* Event detail dialog */}
      <EventDialog
        event={selectedEvent}
        actions={dialogActions}
        closeLabel={labels.closeDialog}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}
