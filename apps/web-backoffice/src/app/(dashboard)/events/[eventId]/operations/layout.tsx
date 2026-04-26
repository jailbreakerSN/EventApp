"use client";

/**
 * Organizer overhaul — Phase O4. Operations section sub-layout —
 * sub-nav for Paiements / Feed + the legacy Check-in route.
 *
 * Check-in keeps its existing URL (`/events/[id]/checkin`) so
 * external bookmarks survive; the sub-nav simply links there.
 */

import { useParams } from "next/navigation";
import { Wallet, MessageSquare, ScanLine } from "lucide-react";
import { EventSubLayout, type EventSubNavItem } from "@/components/event-detail/EventSubLayout";

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  const { eventId } = useParams<{ eventId: string }>();
  const items: EventSubNavItem[] = [
    {
      id: "payments",
      label: "Paiements",
      href: `/events/${eventId}/operations/payments`,
      icon: Wallet,
    },
    {
      id: "feed",
      label: "Fil d'actualité",
      href: `/events/${eventId}/operations/feed`,
      icon: MessageSquare,
    },
    {
      id: "checkin",
      label: "Check-in",
      href: `/events/${eventId}/checkin`,
      icon: ScanLine,
    },
  ];

  return (
    <EventSubLayout sectionLabel="Opérations" items={items}>
      {children}
    </EventSubLayout>
  );
}
