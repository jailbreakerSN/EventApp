"use client";

/**
 * Organizer overhaul — Phase O4. Audience section sub-layout —
 * sub-nav for Inscriptions / Intervenants / Sponsors.
 */

import { useParams } from "next/navigation";
import { Users, Mic, Briefcase } from "lucide-react";
import { EventSubLayout, type EventSubNavItem } from "@/components/event-detail/EventSubLayout";

export default function AudienceLayout({ children }: { children: React.ReactNode }) {
  const { eventId } = useParams<{ eventId: string }>();
  const items: EventSubNavItem[] = [
    {
      id: "registrations",
      label: "Inscriptions",
      href: `/events/${eventId}/audience/registrations`,
      icon: Users,
    },
    {
      id: "speakers",
      label: "Intervenants",
      href: `/events/${eventId}/audience/speakers`,
      icon: Mic,
      planLocked: true,
    },
    {
      id: "sponsors",
      label: "Sponsors",
      href: `/events/${eventId}/audience/sponsors`,
      icon: Briefcase,
      planLocked: true,
    },
  ];

  return (
    <EventSubLayout sectionLabel="Audience" items={items}>
      {children}
    </EventSubLayout>
  );
}
