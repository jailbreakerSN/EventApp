"use client";

import { CompareProvider } from "@/components/compare-events";
import { CompareCheckbox } from "@/components/event-card-compare";
import { EventCard } from "@/components/event-card";
import type { Event } from "@teranga/shared-types";

interface EventGridWithCompareProps {
  events: Event[];
}

export function EventGridWithCompare({ events }: EventGridWithCompareProps) {
  return (
    <CompareProvider>
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((event) => (
          <div key={event.id} className="relative">
            <CompareCheckbox eventId={event.id} />
            <EventCard event={event} />
          </div>
        ))}
      </div>
    </CompareProvider>
  );
}
