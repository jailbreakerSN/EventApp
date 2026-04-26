"use client";

/**
 * Organizer overhaul — Phase O4. Operations › Paiements sub-page.
 */

import { useParams } from "next/navigation";
import { PaymentsTab } from "../../_event-shell/event-detail-content";

export default function OperationsPaymentsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return <PaymentsTab eventId={eventId ?? ""} />;
}
