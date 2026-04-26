/**
 * Organizer overhaul — Phase O10.
 *
 * Pure helpers for the co-organizer scope hook. Lives separately so
 * tests can import the helper without booting Firebase / React Query.
 */

export type CoOrganizerForbiddenSection =
  | "finance"
  | "organization"
  | "billing"
  | "participants"
  | "analytics";

export const FORBIDDEN_CO_ORGANIZER_SECTIONS = new Set<CoOrganizerForbiddenSection>([
  "finance",
  "organization",
  "billing",
  "participants",
  "analytics",
]);

/**
 * Decision logic shared between the hook and the unit tests. Pure —
 * no React, no fetch, no firebase. Single-event auto-scoping is
 * intentionally narrow (exactly 1 event) so a co-organizer with two
 * events keeps the picker.
 */
export function deriveCoOrganizerScope(args: {
  roles: readonly string[];
  events: ReadonlyArray<{ id: string }>;
}): { isCoOrganizer: boolean; scopedEventId: string | undefined } {
  const isCoOrganizer = args.roles.includes("co_organizer") && !args.roles.includes("organizer");
  const scopedEventId = isCoOrganizer && args.events.length === 1 ? args.events[0].id : undefined;
  return { isCoOrganizer, scopedEventId };
}
