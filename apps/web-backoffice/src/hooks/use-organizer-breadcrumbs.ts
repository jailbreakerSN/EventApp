"use client";

/**
 * Organizer overhaul — Phase O1.
 *
 * Hook that derives a breadcrumb trail for the organizer shell from:
 *   1. The current pathname.
 *   2. The role-filtered nav taxonomy (`useOrganizerNav`).
 *   3. The current event title when on `/events/[id]/...` (fetched
 *      via `useEvent` — already cached because the event detail page
 *      itself uses the same query).
 *
 * The pure logic lives in `use-organizer-breadcrumbs-utils.ts` so
 * unit tests can exercise the path → trail derivation without booting
 * Firebase. This hook is the React glue layer only.
 */

import { useMemo } from "react";
import { useParams, usePathname } from "next/navigation";
import { useOrganizerNav } from "@/hooks/use-organizer-nav";
import { useEvent } from "@/hooks/use-events";
import {
  deriveBreadcrumbs,
  type OrganizerBreadcrumbsContext,
  type BreadcrumbItem,
} from "@/hooks/use-organizer-breadcrumbs-utils";

export type { OrganizerBreadcrumbsContext, BreadcrumbItem };

export function useOrganizerBreadcrumbs(): OrganizerBreadcrumbsContext {
  const pathname = usePathname();
  const params = useParams<{ eventId?: string }>();
  const { allItems } = useOrganizerNav();

  // Only fetch the event title when we're actually on an event-scoped
  // route. The query is shared with the event detail page so this is
  // a cache hit in 99% of cases.
  const eventId = params?.eventId ?? null;
  const { data: eventResp } = useEvent(eventId ?? "");
  const eventTitle = eventResp?.data?.title ?? null;

  return useMemo(
    () => deriveBreadcrumbs({ pathname, navItems: allItems, eventId, eventTitle }),
    [pathname, allItems, eventId, eventTitle],
  );
}
