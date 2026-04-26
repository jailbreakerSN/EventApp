"use client";

/**
 * Organizer overhaul — Phase O4. Configuration › Zones d'accès sub-page.
 */

import { useParams } from "next/navigation";
import { Skeleton, QueryError } from "@teranga/shared-ui";
import { useEvent } from "@/hooks/use-events";
import { AccessZonesTab } from "../../_event-shell/event-detail-content";

export default function ConfigurationZonesPage() {
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

  return <AccessZonesTab event={event} />;
}
