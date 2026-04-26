"use client";

/**
 * Organizer overhaul — Phase O4. Audience › Sponsors sub-page.
 * Plan-gated behind `sponsorPortal` (Pro+).
 */

import { useParams } from "next/navigation";
import { PlanGate } from "@/components/plan/PlanGate";
import { SponsorsTab } from "../../_event-shell/event-detail-content";

export default function AudienceSponsorsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return (
    <PlanGate feature="sponsorPortal" fallback="blur">
      <SponsorsTab eventId={eventId ?? ""} />
    </PlanGate>
  );
}
