// Helper that maps an Event (from @teranga/shared-types) + i18n context
// onto the shape expected by shared-ui's <EditorialEventCard>.
//
// The shared-ui primitive is intentionally locale-agnostic — all user-
// facing strings (date, city, price, category, urgency, registered line,
// aria-label) must arrive pre-translated from the consumer. This helper
// centralises the mapping so every editorial card surface in the
// participant app renders identical copy and urgency thresholds.

import { formatCurrency, formatDate } from "@teranga/shared-ui";
import type { EditorialEventCardProps } from "@teranga/shared-ui";
import type { Event } from "@teranga/shared-types";

interface TranslationProvider {
  common: (key: "free") => string;
  categories: (key: string) => string;
  remainingSeats: (count: number) => string;
  registeredWithFill: (count: number, pct: number) => string;
  registeredCount: (count: number) => string;
}

export interface EditorialCardAdapterArgs {
  event: Event;
  index?: number;
  total?: number;
  /** BCP-47 regional tag (e.g. "fr-SN"). */
  locale: string;
  t: TranslationProvider;
}

/**
 * Map an Event + i18n context onto EditorialEventCardProps. Computes
 * the min price, capacity/urgency thresholds and ARIA label exactly
 * once per card so the primitive stays dumb.
 */
export function mapEventToEditorialCardProps({
  event,
  index = 1,
  total = 1,
  locale,
  t,
}: EditorialCardAdapterArgs): Omit<
  EditorialEventCardProps,
  "linkComponent" | "imageComponent"
> {
  const minPrice =
    event.ticketTypes.length > 0 ? Math.min(...event.ticketTypes.map((tt) => tt.price)) : null;
  const isFree = minPrice === 0 || minPrice === null;
  const priceLabel = isFree ? t.common("free") : formatCurrency(minPrice, "XOF", locale);

  const capacity = event.maxAttendees ?? null;
  const registered = event.registeredCount ?? 0;
  const soldPct = capacity && capacity > 0 ? Math.round((registered / capacity) * 100) : null;
  const remaining = capacity !== null ? Math.max(0, capacity - registered) : null;

  const urgencyLabel =
    remaining !== null && remaining > 0 && soldPct !== null && soldPct >= 85
      ? t.remainingSeats(remaining)
      : null;

  const city = event.location?.city ?? event.location?.name ?? null;
  const dateLabel = formatDate(event.startDate, locale);
  const categoryLabel = t.categories(event.category);

  const registeredLabel =
    registered > 0
      ? soldPct !== null
        ? t.registeredWithFill(registered, soldPct)
        : t.registeredCount(registered)
      : null;

  const ariaLabel = `${event.title} — ${dateLabel}${city ? `, ${city}` : ""} — ${priceLabel}`;

  return {
    href: `/events/${event.slug}`,
    coverKey: event.id,
    coverImageUrl: event.coverImageURL ?? null,
    categoryLabel,
    urgencyLabel,
    index,
    total,
    dateLabel,
    cityLabel: city,
    title: event.title,
    description: event.description ?? null,
    priceLabel,
    registeredLabel,
    ariaLabel,
  };
}
