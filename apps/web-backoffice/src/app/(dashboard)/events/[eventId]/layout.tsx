"use client";

/**
 * Organizer overhaul — Phase O4.
 *
 * Top-level shell for the event-detail surface. Replaces the 10-tab
 * monolith with a 4-section information architecture:
 *
 *   /events/[eventId]/overview       — Vue d'ensemble (health, actions)
 *   /events/[eventId]/configuration  — Infos / Billets / Sessions / Zones / Promos
 *   /events/[eventId]/audience       — Inscriptions / Intervenants / Sponsors
 *   /events/[eventId]/operations     — Paiements / Feed / Check-in
 *
 * The layout owns:
 *   - Event data fetch (shared across sub-pages via useEvent cache).
 *   - Header (title, status, actions, "Check-in" pill when published).
 *   - Top-level 4-section tab strip with mobile-friendly overflow.
 *
 * The EventHealthCard remains on the `/overview` route only — it
 * shouldn't compete with the configuration form for vertical space
 * once the operator drills in.
 *
 * The `/checkin` and `/checkin/history` legacy routes are explicitly
 * kept at their existing URLs (no redirect) so external bookmarks
 * stay working. The `Operations` sub-nav links to them; the `<main>`
 * children for those routes simply render outside this chrome via
 * Next.js's normal nesting.
 */

import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { ScanLine, type LucideIcon } from "lucide-react";
import { useEvent } from "@/hooks/use-events";
import { Skeleton, QueryError } from "@teranga/shared-ui";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { EventActions, StatusBadge } from "./_event-shell/event-detail-content";
import { LayoutDashboard, Settings2, Users, Wrench } from "lucide-react";

interface SectionLink {
  id: string;
  label: string;
  href: (eventId: string) => string;
  icon: LucideIcon;
  /** Pathname prefix used to detect the active section. */
  prefix: (eventId: string) => string;
}

const SECTIONS: readonly SectionLink[] = [
  {
    id: "overview",
    label: "Vue d'ensemble",
    href: (id) => `/events/${id}/overview`,
    icon: LayoutDashboard,
    prefix: (id) => `/events/${id}/overview`,
  },
  {
    id: "configuration",
    label: "Configuration",
    href: (id) => `/events/${id}/configuration`,
    icon: Settings2,
    prefix: (id) => `/events/${id}/configuration`,
  },
  {
    id: "audience",
    label: "Audience",
    href: (id) => `/events/${id}/audience`,
    icon: Users,
    prefix: (id) => `/events/${id}/audience`,
  },
  {
    id: "operations",
    label: "Opérations",
    href: (id) => `/events/${id}/operations`,
    icon: Wrench,
    prefix: (id) => `/events/${id}/operations`,
  },
];

/**
 * Returns true when the current pathname is one of the legacy
 * full-screen routes that should NOT be wrapped by the standard
 * event chrome. The check-in surfaces fall here so the scan UI
 * keeps the entire viewport.
 */
function isFullScreenRoute(pathname: string, eventId: string): boolean {
  return (
    pathname === `/events/${eventId}/checkin` || pathname.startsWith(`/events/${eventId}/checkin/`)
  );
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
  const { eventId } = useParams<{ eventId: string }>();
  const pathname = usePathname();
  const { data: eventResp, isLoading, error } = useEvent(eventId ?? "");
  const event = eventResp?.data;

  // Bypass the chrome on full-screen surfaces (check-in scan + history).
  if (isFullScreenRoute(pathname, eventId ?? "")) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton variant="text" className="h-7 w-2/3" />
        <Skeleton variant="text" className="h-4 w-1/3" />
        <div className="flex gap-2">
          {SECTIONS.map((s) => (
            <Skeleton key={s.id} variant="text" className="h-8 w-32" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <QueryError
        title="Impossible de charger l'événement"
        message="Vérifiez le lien ou réessayez dans quelques instants."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header — title, status, primary actions */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-foreground">{event.title}</h1>
            <StatusBadge status={event.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDate(event.startDate)} — {event.location?.city ?? "En ligne"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {event.status === "published" && (
            <Link
              href={`/events/${eventId}/checkin`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium"
            >
              <ScanLine className="h-4 w-4" />
              Check-in
            </Link>
          )}
          <EventActions event={event} />
        </div>
      </div>

      {/* Section tab strip */}
      <nav
        className="flex gap-1 border-b border-border overflow-x-auto scrollbar-none"
        aria-label="Sections de l'événement"
      >
        {SECTIONS.map((section) => {
          const active = pathname.startsWith(section.prefix(eventId ?? ""));
          const Icon = section.icon;
          return (
            <Link
              key={section.id}
              href={section.href(eventId ?? "")}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 motion-safe:transition-colors whitespace-nowrap",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {section.label}
            </Link>
          );
        })}
      </nav>

      {/* Section content */}
      <div>{children}</div>
    </div>
  );
}
