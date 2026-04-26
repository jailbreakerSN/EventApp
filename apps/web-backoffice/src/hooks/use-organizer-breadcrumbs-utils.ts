/**
 * Organizer overhaul — Phase O1.
 *
 * Pure helpers for `useOrganizerBreadcrumbs`. Extracted so unit tests
 * can exercise the path → trail derivation without booting Firebase
 * (the hook in `use-organizer-breadcrumbs.ts` transitively pulls in
 * the Firebase auth SDK via `useEvent`, which the test runner can't
 * initialise without a real API key).
 *
 * Same separation as `event-switcher-utils.ts`. The React layer is
 * the thinnest possible wrapper around these helpers.
 */

import type { OrganizerNavItem } from "@/hooks/use-organizer-nav";

export interface BreadcrumbItem {
  label: string;
  /** Absolute href. Omitted for the LAST crumb (the current page). */
  href?: string;
}

export interface OrganizerBreadcrumbsContext {
  items: readonly BreadcrumbItem[];
  /** False when the breadcrumb panel should not be rendered at all. */
  shouldRender: boolean;
}

/**
 * Routes where the breadcrumbs panel is intentionally hidden — landing
 * pages where a single crumb pointing at itself is visual noise.
 */
const HIDDEN_PATHS = new Set<string>(["/dashboard", "/inbox", "/"]);

const KNOWN_SUB_LABELS: Record<string, string> = {
  checkin: "Check-in",
  history: "Historique",
  billing: "Facturation",
  notifications: "Notifications",
  "api-keys": "Clés API",
  registrations: "Inscriptions",
  tickets: "Billets",
  sessions: "Sessions",
  zones: "Zones",
  speakers: "Intervenants",
  sponsors: "Sponsors",
  promos: "Codes promo",
  feed: "Fil d'actualité",
  payments: "Paiements",
  edit: "Modifier",
  new: "Nouveau",
  // Phase O4 — top-level event sections.
  overview: "Vue d'ensemble",
  configuration: "Configuration",
  audience: "Audience",
  operations: "Opérations",
  infos: "Infos",
};

export function humaniseSubSection(segment: string): string {
  if (KNOWN_SUB_LABELS[segment]) return KNOWN_SUB_LABELS[segment];
  // Replace dashes with spaces and capitalise the first letter.
  const spaced = segment.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Pure helper exported for unit tests.
 *
 * Given a pathname + the role-filtered nav items + (optionally) the
 * current event title, produce the breadcrumb trail.
 *
 * Strategy:
 *  - The first crumb is always "Tableau de bord".
 *  - We then walk the pathname segment by segment and try to match
 *    each segment against (a) a top-level nav item, (b) an event
 *    detail (the segment is an event id), or (c) a known sub-section
 *    of an event (`checkin`, `history`).
 *  - Unknown segments fall through to a humanised label
 *    (capitalised, dashes → spaces) so an exotic future route still
 *    renders something readable.
 */
export function deriveBreadcrumbs(args: {
  pathname: string;
  navItems: readonly OrganizerNavItem[];
  eventId?: string | null;
  eventTitle?: string | null;
}): OrganizerBreadcrumbsContext {
  const { pathname, navItems, eventId, eventTitle } = args;
  if (HIDDEN_PATHS.has(pathname)) {
    return { items: [], shouldRender: false };
  }

  const items: BreadcrumbItem[] = [{ label: "Tableau de bord", href: "/dashboard" }];

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return { items: [], shouldRender: false };
  }

  // Special-case the events path — `/events`, `/events/[id]`, and
  // `/events/[id]/{section}` all benefit from a richer trail than a
  // naive segment walk would produce.
  if (segments[0] === "events") {
    items.push({
      label: "Événements",
      href: segments.length === 1 ? undefined : "/events",
    });
    if (segments.length === 1) {
      // /events
      return { items, shouldRender: true };
    }

    const idOrAction = segments[1];
    if (idOrAction === "new") {
      items.push({ label: "Nouvel événement" });
      return { items, shouldRender: true };
    }

    // /events/[id]...
    const title = eventId === idOrAction ? eventTitle : null;
    const eventLabel = title ?? "Événement";
    if (segments.length === 2) {
      items.push({ label: eventLabel });
      return { items, shouldRender: true };
    }

    items.push({ label: eventLabel, href: `/events/${idOrAction}` });
    const sub = segments[2];
    if (segments.length === 3) {
      items.push({ label: humaniseSubSection(sub) });
      return { items, shouldRender: true };
    }
    items.push({
      label: humaniseSubSection(sub),
      href: `/events/${idOrAction}/${sub}`,
    });
    items.push({ label: humaniseSubSection(segments[3]) });
    return { items, shouldRender: true };
  }

  // Generic path — find the LONGEST nav item href that is a prefix of
  // the current path. This way `/organization/billing` matches the
  // Facturation entry directly (terminal crumb) rather than rendering
  // as `Organisation › Facturation`, while `/organization/api-keys`
  // (no exact nav entry) falls back to `Organisation › Clés API`.
  const candidates = navItems.filter((item) => {
    const itemSegments = item.href.split("/").filter(Boolean);
    if (itemSegments.length > segments.length) return false;
    return itemSegments.every((seg, i) => seg === segments[i]);
  });
  const navHit =
    candidates.length > 0
      ? candidates.reduce((best, current) =>
          current.href.length > best.href.length ? current : best,
        )
      : undefined;
  if (navHit) {
    const navItemSegs = navHit.href.split("/").filter(Boolean);
    if (navItemSegs.length === segments.length) {
      // Exact match → terminal crumb.
      items.push({ label: navHit.label });
      return { items, shouldRender: true };
    }
    items.push({ label: navHit.label, href: navHit.href });
    // Walk the remaining segments — humanised — building hrefs
    // progressively so each crumb except the last is clickable.
    for (let i = navItemSegs.length; i < segments.length; i++) {
      const isLast = i === segments.length - 1;
      const href = "/" + segments.slice(0, i + 1).join("/");
      items.push({ label: humaniseSubSection(segments[i]), href: isLast ? undefined : href });
    }
    return { items, shouldRender: true };
  }

  // Unknown root segment — render a single fallback crumb so the
  // header is never empty mid-shell.
  items.push({ label: humaniseSubSection(segments[0]) });
  for (let i = 1; i < segments.length; i++) {
    items.push({ label: humaniseSubSection(segments[i]) });
  }
  return { items, shouldRender: true };
}
