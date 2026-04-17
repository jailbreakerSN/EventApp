"use client";

import { CalendarPlus } from "lucide-react";
import { useTranslations } from "next-intl";

interface AddToCalendarProps {
  title: string;
  description: string;
  location: string;
  startDate: string;
  endDate: string;
}

function toIcsDate(isoDate: string): string {
  return new Date(isoDate).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function generateIcsContent({
  title,
  description,
  location,
  startDate,
  endDate,
}: AddToCalendarProps): string {
  const cleanDesc = description.replace(/\n/g, "\\n").slice(0, 500);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Teranga Events//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `DTSTART:${toIcsDate(startDate)}`,
    `DTEND:${toIcsDate(endDate)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${cleanDesc}`,
    `LOCATION:${location}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function getGoogleCalendarUrl({
  title,
  description,
  location,
  startDate,
  endDate,
}: AddToCalendarProps): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    details: description.slice(0, 500),
    location,
    dates: `${toIcsDate(startDate)}/${toIcsDate(endDate)}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function AddToCalendar(props: AddToCalendarProps) {
  const t = useTranslations("addToCalendar");

  const downloadIcs = () => {
    const content = generateIcsContent(props);
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50)}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <a
        href={getGoogleCalendarUrl(props)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        aria-label={t("googleAria")}
      >
        <CalendarPlus className="h-4 w-4 text-teranga-gold" />
        {t("google")}
      </a>

      <button
        onClick={downloadIcs}
        className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        aria-label={t("downloadIcsAria")}
      >
        <CalendarPlus className="h-4 w-4 text-teranga-gold" />
        {t("downloadIcs")}
      </button>
    </div>
  );
}
