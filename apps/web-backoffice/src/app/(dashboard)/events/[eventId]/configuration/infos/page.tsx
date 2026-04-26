"use client";

/**
 * Organizer overhaul — Phase O4. Configuration › Infos sub-page.
 *
 * Thin wrapper around the legacy `InfoTab` component (kept inline
 * inside `_event-shell/event-detail-content.tsx` until a future
 * refactor extracts each tab to its own file). The wrapper handles
 * the per-page event fetch + loading/error fallbacks; the tab
 * itself is purely presentational.
 */

import { useParams } from "next/navigation";
import { Skeleton, QueryError } from "@teranga/shared-ui";
import { useEvent } from "@/hooks/use-events";
import { InfoTab } from "../../_event-shell/event-detail-content";

export default function ConfigurationInfosPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { data: eventResp, isLoading, error } = useEvent(eventId ?? "");
  const event = eventResp?.data;

  if (isLoading) {
    return <Skeleton variant="text" className="h-32 w-full" />;
  }
  if (error || !event) {
    return (
      <QueryError
        title="Impossible de charger l'événement"
        message="Réessayez dans quelques instants."
      />
    );
  }

  return <InfoTab event={event} />;
}
