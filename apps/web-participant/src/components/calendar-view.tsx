"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Registration } from "@teranga/shared-types";

type RegistrationWithExtras = Registration & {
  paymentId?: string;
  waitlistPosition?: number;
};

interface CalendarViewProps {
  registrations: RegistrationWithExtras[];
}

const STATUS_DOT: Record<string, string> = {
  confirmed: "bg-teranga-green",
  checked_in: "bg-blue-500",
  pending: "bg-teranga-gold",
  pending_payment: "bg-teranga-gold",
  waitlisted: "bg-teranga-clay",
  cancelled: "bg-muted-foreground",
  refund_requested: "bg-teranga-clay",
  refunded: "bg-muted-foreground",
};

function getDakar(iso: string) {
  return new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Africa/Dakar" }));
}

export function CalendarView({ registrations }: CalendarViewProps) {
  const t = useTranslations("myEvents.calendar");

  const today = getDakar(new Date().toISOString());
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed

  const monthLabel = new Date(year, month, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "Africa/Dakar",
  });

  // Map day-of-month → registrations that start on that day
  const eventsByDay = useMemo(() => {
    const map = new Map<number, RegistrationWithExtras[]>();
    for (const reg of registrations) {
      if (!reg.eventStartDate || reg.status === "cancelled" || reg.status === "refunded") continue;
      const d = getDakar(reg.eventStartDate);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        map.set(day, [...(map.get(day) ?? []), reg]);
      }
    }
    return map;
  }, [registrations, year, month]);

  // Grid cells: leading blanks + days of month
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun
  // Monday-first: shift Sunday (0) to position 6
  const leadingBlanks = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  function prev() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }
  function next() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }

  const dayNames = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  return (
    <div className="rounded-card border bg-card overflow-hidden">
      {/* Month navigation */}
      <div className="flex items-center justify-between px-5 py-4 border-b">
        <button
          onClick={prev}
          className="p-1.5 rounded-full hover:bg-muted transition-colors"
          aria-label={t("prevMonth")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="font-serif-display text-[15px] font-semibold capitalize tracking-[-0.01em]">
          {monthLabel}
        </p>
        <button
          onClick={next}
          className="p-1.5 rounded-full hover:bg-muted transition-colors"
          aria-label={t("nextMonth")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b">
        {dayNames.map((d) => (
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
            className="min-h-[72px] border-b border-r last:border-r-0 bg-muted/20"
          />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, idx) => {
          const day = idx + 1;
          const col = (leadingBlanks + idx) % 7;
          const isToday =
            day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
          const dayRegs = eventsByDay.get(day) ?? [];
          const isLastCol = col === 6;

          return (
            <div
              key={day}
              className={`min-h-[72px] border-b p-1.5 flex flex-col gap-1 ${
                isLastCol ? "" : "border-r"
              } ${isToday ? "bg-teranga-gold/5" : ""}`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center self-end rounded-full text-xs font-semibold ${
                  isToday
                    ? "bg-teranga-navy text-white dark:bg-teranga-gold dark:text-teranga-navy"
                    : "text-muted-foreground"
                }`}
              >
                {day}
              </span>
              {dayRegs.slice(0, 2).map((reg) => (
                <Link
                  key={reg.id}
                  href={`/events/${reg.eventSlug ?? reg.eventId}`}
                  className="group flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight hover:bg-muted truncate"
                  title={reg.eventTitle ?? reg.eventId}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[reg.status] ?? "bg-muted-foreground"}`}
                    aria-hidden="true"
                  />
                  <span className="truncate group-hover:text-teranga-gold-dark">
                    {reg.eventTitle ?? reg.eventId}
                  </span>
                </Link>
              ))}
              {dayRegs.length > 2 && (
                <span className="px-1.5 text-[10px] text-muted-foreground">
                  +{dayRegs.length - 2} {t("more")}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 border-t px-5 py-3">
        <span className="font-mono-kicker text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {t("legend")}
        </span>
        {[
          { label: t("confirmed"), color: "bg-teranga-green" },
          { label: t("checkedIn"), color: "bg-blue-500" },
          { label: t("pending"), color: "bg-teranga-gold" },
          { label: t("waitlisted"), color: "bg-teranga-clay" },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
