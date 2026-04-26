"use client";

/**
 * Organizer overhaul — Phase O4. Audience › Inscriptions sub-page.
 */

import { useParams } from "next/navigation";
import { RegistrationsTab } from "../../_event-shell/event-detail-content";

export default function AudienceRegistrationsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return <RegistrationsTab eventId={eventId ?? ""} />;
}
