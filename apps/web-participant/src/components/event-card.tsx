import Link from "next/link";
import Image from "next/image";
import { Calendar, MapPin } from "lucide-react";
import { Badge } from "@teranga/shared-ui";
import { formatDate, formatCurrency } from "@teranga/shared-ui";
import type { Event } from "@teranga/shared-types";

interface EventCardProps {
  event: Event;
}

export function EventCard({ event }: EventCardProps) {
  const minPrice = event.ticketTypes.length > 0
    ? Math.min(...event.ticketTypes.map((t) => t.price))
    : null;
  const isFree = minPrice === 0 || minPrice === null;

  return (
    <Link
      href={`/events/${event.slug}`}
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
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-teranga-navy to-teranga-navy/80">
            <span className="text-3xl font-bold text-teranga-gold">{event.title.charAt(0)}</span>
          </div>
        )}
        {event.category && (
          <Badge variant="secondary" className="absolute left-3 top-3">
            {event.category}
          </Badge>
        )}
      </div>

      <div className="p-4">
        <h3 className="line-clamp-2 text-base font-semibold text-foreground group-hover:text-teranga-gold transition-colors">
          {event.title}
        </h3>

        <div className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{formatDate(event.startDate)}</span>
          </div>
          {event.location?.name && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="line-clamp-1">{event.location.name}</span>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-teranga-gold">
            {isFree ? "Gratuit" : `À partir de ${formatCurrency(minPrice!)}`}
          </span>
        </div>
      </div>
    </Link>
  );
}
