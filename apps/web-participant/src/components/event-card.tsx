"use client";

import Link from "next/link";
import Image from "next/image";
import { Calendar, MapPin, Users } from "lucide-react";
import { Badge, formatDate, formatCurrency } from "@teranga/shared-ui";
import { useLocale, useTranslations } from "next-intl";
import type { Event } from "@teranga/shared-types";

interface EventCardProps {
  event: Event;
}

export function EventCard({ event }: EventCardProps) {
  const locale = useLocale();
  const t = useTranslations();

  const minPrice =
    event.ticketTypes.length > 0 ? Math.min(...event.ticketTypes.map((t) => t.price)) : null;
  const isFree = minPrice === 0 || minPrice === null;

  const priceLabel = isFree
    ? t("common.free")
    : t("common.fromPrice", { price: formatCurrency(minPrice!, "XOF", intlLocale(locale)) });
  const locationLabel = event.location?.name ? `, ${event.location.name}` : "";
  const cardAriaLabel = `${event.title} — ${formatDate(event.startDate, intlLocale(locale))}${locationLabel} — ${priceLabel}`;

  const categoryLabel = t(`categories.${event.category}` as `categories.${typeof event.category}`);

  return (
    <Link
      href={`/events/${event.slug}`}
      aria-label={cardAriaLabel}
      className="group overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-muted">
        {event.coverImageURL ? (
          <Image
            src={event.coverImageURL}
            alt={event.title}
            fill
            className="object-cover transition-transform group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-full items-center justify-center bg-gradient-to-br from-teranga-navy to-teranga-navy/80"
          >
            <span className="text-3xl font-bold text-teranga-gold">{event.title.charAt(0)}</span>
          </div>
        )}
        {event.category && (
          <Badge variant="secondary" className="absolute left-3 top-3" aria-hidden="true">
            {categoryLabel}
          </Badge>
        )}
      </div>

      <div className="p-4" aria-hidden="true">
        <h3 className="line-clamp-2 text-base font-semibold text-foreground group-hover:text-teranga-gold transition-colors">
          {event.title}
        </h3>

        <div className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            <span>{formatDate(event.startDate, intlLocale(locale))}</span>
          </div>
          {event.location?.name && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="line-clamp-1">{event.location.name}</span>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-teranga-gold">{priceLabel}</span>
          {event.registeredCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" aria-hidden="true" />
              <span>{event.registeredCount}</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// next-intl gives us locale codes like "fr" / "en" / "wo" but Intl.*
// expects BCP-47 regional tags. The app targets Senegal, so map every
// supported locale to its SN regional form; unknown locales fall back
// to the raw code so new translations keep working without a code edit.
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
