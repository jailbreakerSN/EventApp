/**
 * Organizer overhaul — Phase O1.
 *
 * Pure helpers extracted from `event-switcher.tsx` so unit tests can
 * exercise the lifecycle bucketing logic without booting Firebase
 * (the React component imports `useEvents` which transitively pulls
 * in `firebase/auth`, and the test runner has no real API key).
 *
 * Keeping the React file thin (just JSX + state) and the logic in
 * this module is the same separation the admin shell uses for its
 * inbox aggregations — see `apps/api/src/services/admin.service.ts`
 * `safeCount()` extracted for testability.
 */

import type { Event as TerangaEvent } from "@teranga/shared-types";

export type SwitcherGroupKey = "live" | "upcoming" | "drafts";

export interface SwitcherGroup {
  key: SwitcherGroupKey;
  events: TerangaEvent[];
}

export const SWITCHER_GROUP_LABEL: Record<SwitcherGroupKey, string> = {
  live: "En cours",
  upcoming: "À venir",
  drafts: "Brouillons",
};

export const SWITCHER_GROUP_ORDER: readonly SwitcherGroupKey[] = ["live", "upcoming", "drafts"];

/** Strip diacritics + lowercase — used by the search filter. */
export function normaliseSearchTerm(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function safeStart(ev: TerangaEvent): number {
  return ev.startDate ? new Date(ev.startDate).getTime() : Number.POSITIVE_INFINITY;
}
function safeUpdated(ev: TerangaEvent): number {
  return ev.updatedAt ? new Date(ev.updatedAt).getTime() : 0;
}

/**
 * Group events by lifecycle position relative to `now`.
 *
 * Contract:
 *  - "live" — published AND startDate ≤ now ≤ endDate (or startDate
 *    when endDate is null). Earliest start first (the most-urgent one).
 *  - "upcoming" — published AND startDate > now. Earliest start first.
 *  - "drafts" — status === "draft", regardless of dates. Most recently
 *    updated first.
 *  - Cancelled / completed / archived / past-published-without-end —
 *    excluded entirely. The switcher only surfaces actionable
 *    destinations; the operator goes to /events to dig into history.
 */
export function groupEvents(
  events: readonly TerangaEvent[],
  now: Date = new Date(),
): SwitcherGroup[] {
  const live: TerangaEvent[] = [];
  const upcoming: TerangaEvent[] = [];
  const drafts: TerangaEvent[] = [];
  const nowMs = now.getTime();

  for (const ev of events) {
    if (ev.status === "draft") {
      drafts.push(ev);
      continue;
    }
    if (ev.status !== "published") continue;
    const start = ev.startDate ? new Date(ev.startDate).getTime() : Number.POSITIVE_INFINITY;
    const end = ev.endDate ? new Date(ev.endDate).getTime() : start;
    if (nowMs >= start && nowMs <= end) {
      live.push(ev);
    } else if (start > nowMs) {
      upcoming.push(ev);
    }
    // Past published events without a window that contains `now` are
    // intentionally dropped here.
  }

  live.sort((a, b) => safeStart(a) - safeStart(b));
  upcoming.sort((a, b) => safeStart(a) - safeStart(b));
  drafts.sort((a, b) => safeUpdated(b) - safeUpdated(a));

  const all: SwitcherGroup[] = [
    { key: "live", events: live },
    { key: "upcoming", events: upcoming },
    { key: "drafts", events: drafts },
  ];
  return all.filter((g) => g.events.length > 0);
}
