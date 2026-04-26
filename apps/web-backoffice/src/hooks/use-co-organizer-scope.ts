"use client";

/**
 * Organizer overhaul — Phase O10.
 *
 * Co-organizer scope helper. Three responsibilities:
 *
 *   1. **Detection** — `isCoOrganizer` is `true` when the caller has
 *      the `co_organizer` role and NOT the broader `organizer` role
 *      (mirror of `useOrganizerNav.isCoOrganizer`).
 *   2. **Scoping** — when a co-organizer manages ONE event, surfaces
 *      that would normally show an org-wide listing (the dashboard
 *      root, the event picker on the inbox) should auto-navigate
 *      straight to that single event's overview. The hook surfaces a
 *      `scopedEventId` for that path.
 *   3. **Forbidden checks** — `canAccess(section)` returns `false` for
 *      sections excluded from the co-organizer shell ("finance",
 *      "organization", "billing", "participants", "analytics"). The
 *      `useOrganizerNav` taxonomy already filters those out of the
 *      sidebar, but pages that are linked from elsewhere (search,
 *      breadcrumbs) need a runtime guard.
 *
 * The hook is a thin wrapper over `useEvents` + `useAuth` so the
 * scoping decision happens once per render and survives re-renders
 * via `useMemo`.
 */

import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useEvents } from "@/hooks/use-events";
import {
  FORBIDDEN_CO_ORGANIZER_SECTIONS,
  deriveCoOrganizerScope,
  type CoOrganizerForbiddenSection,
} from "@/hooks/co-organizer-scope.helpers";

export { deriveCoOrganizerScope, type CoOrganizerForbiddenSection };

export interface CoOrganizerScope {
  /**
   * True when the caller is a `co_organizer` and NOT an organizer of
   * any kind. Org-wide users keep the full shell.
   */
  isCoOrganizer: boolean;
  /**
   * When defined, the only event the co-organizer can manage. Used
   * by `/dashboard` to redirect straight to `/events/<id>/overview`.
   */
  scopedEventId: string | undefined;
  /**
   * `false` for sections excluded from the co-organizer shell. Pages
   * call this in their layout / `useEffect` to redirect on
   * unauthorised access.
   */
  canAccess(section: CoOrganizerForbiddenSection): boolean;
  /** Whether the underlying events list is still loading. */
  isLoading: boolean;
}

export function useCoOrganizerScope(): CoOrganizerScope {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const isCoOrganizer = roles.includes("co_organizer") && !roles.includes("organizer");

  const { data: eventsList, isLoading } = useEvents({ limit: 2 }, { enabled: isCoOrganizer });

  return useMemo<CoOrganizerScope>(() => {
    const events = eventsList?.data ?? [];
    const { scopedEventId } = deriveCoOrganizerScope({
      roles,
      events,
    });
    return {
      isCoOrganizer,
      scopedEventId,
      isLoading: isCoOrganizer && isLoading,
      canAccess(section) {
        if (!isCoOrganizer) return true;
        return !FORBIDDEN_CO_ORGANIZER_SECTIONS.has(section);
      },
    };
  }, [isCoOrganizer, roles, isLoading, eventsList]);
}
