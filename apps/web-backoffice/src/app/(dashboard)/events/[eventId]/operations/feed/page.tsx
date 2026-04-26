"use client";

/**
 * Organizer overhaul — Phase O4. Operations › Fil d'actualité sub-page.
 */

import { useParams } from "next/navigation";
import { FeedTab } from "../../_event-shell/event-detail-content";

export default function OperationsFeedPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return <FeedTab eventId={eventId ?? ""} />;
}
