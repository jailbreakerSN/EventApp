/**
 * Organizer overhaul — Phase O4. Audience index → redirects to
 * Inscriptions (the most-trafficked sub-page).
 */

import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function AudienceIndexPage({ params }: PageProps) {
  const { eventId } = await params;
  redirect(`/events/${eventId}/audience/registrations`);
}
