/**
 * Organizer overhaul — Phase O4. Configuration index → redirects to
 * the first sub-page (Infos), so a bare `/configuration` URL never
 * lands on a blank panel.
 */

import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function ConfigurationIndexPage({ params }: PageProps) {
  const { eventId } = await params;
  redirect(`/events/${eventId}/configuration/infos`);
}
