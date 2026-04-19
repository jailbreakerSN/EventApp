import type { EventStatus } from "@teranga/shared-types";

// French labels for event lifecycle statuses. Kept in one place so the
// dashboard, events list, and event detail screens can't silently drift
// (the dashboard was missing `archived` before — `getEventStatusLabel`
// now guarantees every status has a French label).
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: "Brouillon",
  published: "Publié",
  cancelled: "Annulé",
  archived: "Archivé",
  completed: "Terminé",
};

export function getEventStatusLabel(status: string | undefined | null): string {
  if (!status) return EVENT_STATUS_LABELS.draft;
  return EVENT_STATUS_LABELS[status as EventStatus] ?? status;
}
