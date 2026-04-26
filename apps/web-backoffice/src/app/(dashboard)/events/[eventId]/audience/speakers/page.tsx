"use client";

/**
 * Organizer overhaul — Phase O4. Audience › Intervenants sub-page.
 * Plan-gated behind `speakerPortal` (Pro+).
 */

import { useParams } from "next/navigation";
import { PlanGate } from "@/components/plan/PlanGate";
import { SpeakersTab } from "../../_event-shell/event-detail-content";

export default function AudienceSpeakersPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return (
    <PlanGate feature="speakerPortal" fallback="blur">
      <SpeakersTab eventId={eventId ?? ""} />
    </PlanGate>
  );
}
