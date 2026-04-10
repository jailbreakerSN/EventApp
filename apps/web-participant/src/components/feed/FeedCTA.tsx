"use client";

import Link from "next/link";
import { MessageSquare, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface FeedCTAProps {
  eventSlug: string;
}

export function FeedCTA({ eventSlug }: FeedCTAProps) {
  const { user, loading } = useAuth();

  // Only show to authenticated users
  if (loading || !user) return null;

  return (
    <div className="rounded-lg bg-card p-6 shadow-lg">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="h-5 w-5 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Feed communautaire</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        Échangez avec les autres participants, partagez vos impressions et photos.
      </p>
      <Link
        href={`/events/${eventSlug}/feed`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        Rejoindre la discussion
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}
