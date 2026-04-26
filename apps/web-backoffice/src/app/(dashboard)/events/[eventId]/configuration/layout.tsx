"use client";

/**
 * Organizer overhaul — Phase O4.
 *
 * Configuration section sub-layout. Wraps each `configuration/*` page
 * with the shared `<EventSubLayout>` rendering the 5-tab sub-nav:
 * Infos / Billets / Sessions / Zones / Promos.
 */

import { useParams } from "next/navigation";
import { Info, Ticket, Calendar, MapPin, Tag } from "lucide-react";
import { EventSubLayout, type EventSubNavItem } from "@/components/event-detail/EventSubLayout";

export default function ConfigurationLayout({ children }: { children: React.ReactNode }) {
  const { eventId } = useParams<{ eventId: string }>();
  const items: EventSubNavItem[] = [
    {
      id: "infos",
      label: "Infos",
      href: `/events/${eventId}/configuration/infos`,
      icon: Info,
    },
    {
      id: "tickets",
      label: "Billets",
      href: `/events/${eventId}/configuration/tickets`,
      icon: Ticket,
    },
    {
      id: "sessions",
      label: "Sessions",
      href: `/events/${eventId}/configuration/sessions`,
      icon: Calendar,
    },
    {
      id: "zones",
      label: "Zones",
      href: `/events/${eventId}/configuration/zones`,
      icon: MapPin,
    },
    {
      id: "promos",
      label: "Codes promo",
      href: `/events/${eventId}/configuration/promos`,
      icon: Tag,
    },
  ];

  return (
    <EventSubLayout sectionLabel="Configuration" items={items}>
      {children}
    </EventSubLayout>
  );
}
