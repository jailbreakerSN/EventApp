"use client";

/**
 * Organizer overhaul — Phase O4. Configuration › Billets sub-page.
 */

import { useParams } from "next/navigation";
import { Skeleton, QueryError } from "@teranga/shared-ui";
import { useEvent } from "@/hooks/use-events";
import { TicketsTab } from "../../_event-shell/event-detail-content";

export default function ConfigurationTicketsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { data: eventResp, isLoading, error } = useEvent(eventId ?? "");
  const event = eventResp?.data;

  if (isLoading) return <Skeleton variant="text" className="h-32 w-full" />;
  if (error || !event)
    return (
      <QueryError
        title="Impossible de charger l'événement"
        message="Réessayez dans quelques instants."
      />
    );

  return <TicketsTab event={event} />;
}
