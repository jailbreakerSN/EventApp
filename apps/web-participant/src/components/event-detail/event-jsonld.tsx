import type { Event } from "@teranga/shared-types";

interface EventJsonLdProps {
  event: Event;
}

export function EventJsonLd({ event }: EventJsonLdProps) {
  const minPrice = event.ticketTypes.length > 0
    ? Math.min(...event.ticketTypes.map((t) => t.price))
    : 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.shortDescription ?? event.description.slice(0, 300),
    startDate: event.startDate,
    endDate: event.endDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode:
      event.format === "online"
        ? "https://schema.org/OnlineEventAttendanceMode"
        : event.format === "hybrid"
          ? "https://schema.org/MixedEventAttendanceMode"
          : "https://schema.org/OfflineEventAttendanceMode",
    location:
      event.format === "online"
        ? {
            "@type": "VirtualLocation",
            url: event.location.streamUrl ?? undefined,
          }
        : {
            "@type": "Place",
            name: event.location.name,
            address: {
              "@type": "PostalAddress",
              streetAddress: event.location.address,
              addressLocality: event.location.city,
              addressCountry: event.location.country,
            },
            ...(event.location.coordinates
              ? {
                  geo: {
                    "@type": "GeoCoordinates",
                    latitude: event.location.coordinates.lat,
                    longitude: event.location.coordinates.lng,
                  },
                }
              : {}),
          },
    ...(event.coverImageURL ? { image: [event.coverImageURL] } : {}),
    offers: {
      "@type": "Offer",
      price: minPrice,
      priceCurrency: event.ticketTypes[0]?.currency ?? "XOF",
      availability: "https://schema.org/InStock",
      url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/events/${event.slug}`,
    },
    organizer: {
      "@type": "Organization",
      name: "Teranga",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
