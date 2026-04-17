"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { formatDate, formatCurrency } from "@teranga/shared-ui";
import { useLocale, useTranslations } from "next-intl";
import type { Event } from "@teranga/shared-types";

interface EditorialEventCardProps {
  event: Event;
  index?: number;
  total?: number;
}

// Editorial variant of EventCard, modelled on the Teranga Participant
// prototype (teranga-events/project/src/components.jsx → EventCard).
// Differences from the default card:
// - Larger cover tile with branded gradient fallback + grain/stripe texture
// - Serif title, mono date/city row, registered · %-filled stat
// - Circular arrow button instead of a price badge on the right
// - Optional urgency pill when capacity is ≥90% or tickets are low
// Kept as a separate component so existing consumers (compare, events list)
// keep their compact card; the homepage + other editorial surfaces can opt in.
export function EditorialEventCard({ event, index = 1, total = 1 }: EditorialEventCardProps) {
  const locale = useLocale();
  const t = useTranslations();

  const minPrice =
    event.ticketTypes.length > 0 ? Math.min(...event.ticketTypes.map((x) => x.price)) : null;
  const isFree = minPrice === 0 || minPrice === null;
  const priceText = isFree ? t("common.free") : formatCurrency(minPrice!, "XOF", intlLocale(locale));

  const categoryLabel = t(
    `categories.${event.category}` as `categories.${typeof event.category}`,
  );

  // `maxAttendees` is the event-level capacity when set (null = unlimited).
  // ticketTypes also carry `quantityTotal` per tier; we prefer maxAttendees
  // since it's what the organizer pitched as "total seats".
  const capacity = event.maxAttendees ?? null;
  const registered = event.registeredCount ?? 0;
  const soldPct =
    capacity && capacity > 0 ? Math.round((registered / capacity) * 100) : null;

  const city = event.location?.city ?? event.location?.name ?? null;

  const ariaLabel = `${event.title} — ${formatDate(event.startDate, intlLocale(locale))}${
    city ? `, ${city}` : ""
  } — ${priceText}`;

  // Urgency surfaces when a cap is defined and we're getting close to full.
  // Mirrors the prototype's "Plus que X places" gold pill.
  const remaining = capacity !== null ? Math.max(0, capacity - registered) : null;
  const urgencyText =
    remaining !== null && remaining > 0 && soldPct !== null && soldPct >= 85
      ? t("events.card.remainingSeats", { count: remaining })
      : null;

  return (
    <Link
      href={`/events/${event.slug}`}
      aria-label={ariaLabel}
      className="group flex h-full flex-col overflow-hidden rounded-card border bg-card transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-[0_22px_50px_-30px_rgba(15,15,28,0.25),0_2px_6px_-2px_rgba(15,15,28,0.06)]"
    >
      {/* Cover */}
      <div
        className="teranga-cover relative aspect-[16/10] w-full"
        style={{
          background: event.coverImageURL
            ? undefined
            : "linear-gradient(135deg, #1A1A2E 0%, #2a473c 55%, #c59e4b 110%)",
        }}
      >
        {event.coverImageURL && (
          <Image
            src={event.coverImageURL}
            alt=""
            fill
            className="z-0 object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        )}
        <div className="relative z-10 flex h-full items-start justify-between p-3.5">
          {urgencyText ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teranga-clay/95 px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] text-white">
              {urgencyText}
            </span>
          ) : (
            <span className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.08em] text-white/90">
              {categoryLabel}
            </span>
          )}
          <span className="font-mono-kicker text-[10px] tracking-[0.1em] text-white/70">
            TER · {String(index).padStart(3, "0")}/{String(total).padStart(3, "0")}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3.5 p-6" aria-hidden="true">
        <div className="flex items-center justify-between">
          <span className="font-mono-kicker text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            {formatDate(event.startDate, intlLocale(locale))}
          </span>
          {city && (
            <span className="font-mono-kicker text-[11px] text-muted-foreground">{city}</span>
          )}
        </div>

        <h3 className="font-serif-display line-clamp-2 text-[22px] font-semibold leading-[1.15] tracking-[-0.015em] text-balance">
          {event.title}
        </h3>

        {event.description && (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground text-pretty">
            {event.description}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <div>
            <p className="text-[13px] font-semibold text-foreground tabular-nums">{priceText}</p>
            {registered > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {soldPct !== null
                  ? t("events.card.registeredWithFill", { count: registered, pct: soldPct })
                  : t("events.card.registeredCount", { count: registered })}
              </p>
            )}
          </div>
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-muted/40 text-foreground transition-all group-hover:border-teranga-navy group-hover:bg-teranga-navy group-hover:text-white"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

// See event-card.tsx for rationale.
function intlLocale(locale: string): string {
  switch (locale) {
    case "fr":
      return "fr-SN";
    case "en":
      return "en-SN";
    case "wo":
      return "wo-SN";
    default:
      return locale;
  }
}
