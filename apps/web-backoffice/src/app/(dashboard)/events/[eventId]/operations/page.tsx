/**
 * Organizer overhaul — Phase O4. Operations index → redirects to
 * Paiements (the most-actionable financial surface).
 */

import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function OperationsIndexPage({ params }: PageProps) {
  const { eventId } = await params;
  redirect(`/events/${eventId}/operations/payments`);
}
