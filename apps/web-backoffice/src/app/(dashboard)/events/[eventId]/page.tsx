/**
 * Organizer overhaul — Phase O4.
 *
 * The event-detail root no longer renders a tab strip — it redirects
 * to the new "Vue d'ensemble" landing. Every legacy bookmark
 * (`/events/[id]`) lands on `/events/[id]/overview` automatically.
 *
 * Server component on purpose so the redirect happens at the edge,
 * before any client JS ships. The 4-section information architecture
 * lives in the sibling `layout.tsx` (chrome) + per-section
 * `{configuration,audience,operations,overview}/` route segments.
 */

import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ eventId: string }>;
}

export default async function EventRootRedirectPage({ params }: PageProps) {
  const { eventId } = await params;
  redirect(`/events/${eventId}/overview`);
}
