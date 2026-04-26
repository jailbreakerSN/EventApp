"use client";

/**
 * Organizer overhaul — Phase O4. Configuration › Codes promo sub-page.
 */

import { useParams } from "next/navigation";
import { PromosTab } from "../../_event-shell/event-detail-content";

export default function ConfigurationPromosPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return <PromosTab eventId={eventId ?? ""} />;
}
