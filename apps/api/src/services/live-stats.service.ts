/**
 * Organizer overhaul — Phase O8.
 *
 * Live dashboard read model. Aggregates the floor-ops signals into
 * one snapshot every 60 seconds (frontend polls):
 *   - `scanRate`     — last 30 minutes bucketed per minute.
 *   - `queueEstimate` — registered − checked-in.
 *   - `noShowEstimate` — registered with `event.endDate` past and
 *     no scan.
 *   - `staffOnline`  — proxy from per-event staff messages in the
 *     last 5 min (no presence channel exists yet; messages are
 *     the cheapest signal of an active connection).
 *   - `incidentsByStatus` — counts grouped by lifecycle state.
 *
 * Read-only, safe to poll. Permission gating mirrors the live
 * dashboard caller: `checkin:view_log` for any staff/organizer
 * with floor-ops access.
 */

import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type { LiveStats } from "@teranga/shared-types";

const SCAN_WINDOW_MIN = 30;
const STAFF_ONLINE_WINDOW_MIN = 5;
const ONE_MIN_MS = 60_000;

class LiveStatsService extends BaseService {
  async getStats(eventId: string, user: AuthUser): Promise<LiveStats> {
    this.requirePermission(user, "checkin:view_log");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const now = new Date();
    const scanWindowStart = new Date(now.getTime() - SCAN_WINDOW_MIN * ONE_MIN_MS);
    const staffWindowStart = new Date(now.getTime() - STAFF_ONLINE_WINDOW_MIN * ONE_MIN_MS);

    // Run all aggregations in parallel — same `safeCount` ergonomics
    // as the inbox to keep partial-failure tolerance.
    const [
      checkinsSnap,
      registeredCount,
      checkedInCount,
      incidentsOpen,
      incidentsTriaged,
      incidentsInProgress,
      staffMessagesSnap,
    ] = await Promise.all([
      // We need the per-checkin timestamps for the scan-rate buckets,
      // so a `count()` aggregation isn't enough — fetch the docs
      // (capped to 500, the realistic floor-ops volume per 30 min).
      db
        .collection(COLLECTIONS.CHECKINS)
        .where("eventId", "==", eventId)
        .where("createdAt", ">=", scanWindowStart.toISOString())
        .orderBy("createdAt", "asc")
        .limit(500)
        .get(),
      safeCount(() =>
        db
          .collection(COLLECTIONS.REGISTRATIONS)
          .where("eventId", "==", eventId)
          .where("status", "==", "confirmed")
          .count()
          .get()
          .then((s) => s.data().count),
      ),
      safeCount(() =>
        db
          .collection(COLLECTIONS.REGISTRATIONS)
          .where("eventId", "==", eventId)
          .where("status", "==", "checked_in")
          .count()
          .get()
          .then((s) => s.data().count),
      ),
      safeCount(() =>
        db
          .collection(COLLECTIONS.INCIDENTS)
          .where("eventId", "==", eventId)
          .where("status", "==", "open")
          .count()
          .get()
          .then((s) => s.data().count),
      ),
      safeCount(() =>
        db
          .collection(COLLECTIONS.INCIDENTS)
          .where("eventId", "==", eventId)
          .where("status", "==", "triaged")
          .count()
          .get()
          .then((s) => s.data().count),
      ),
      safeCount(() =>
        db
          .collection(COLLECTIONS.INCIDENTS)
          .where("eventId", "==", eventId)
          .where("status", "==", "in_progress")
          .count()
          .get()
          .then((s) => s.data().count),
      ),
      // Staff online proxy — distinct authorIds in the last 5 min
      // of staff messages.
      db
        .collection(COLLECTIONS.STAFF_MESSAGES)
        .where("eventId", "==", eventId)
        .where("createdAt", ">=", staffWindowStart.toISOString())
        .get(),
    ]);

    const scanTimestamps = checkinsSnap.docs.map((d) => {
      const data = d.data() as { createdAt?: string };
      return data.createdAt ?? null;
    });
    const scanRate = bucketScanRate(scanTimestamps, now, SCAN_WINDOW_MIN);

    const queueEstimate = Math.max(0, registeredCount - checkedInCount);
    const noShowEstimate = computeNoShowEstimate(event, registeredCount, checkedInCount, now);

    const staffOnline = countDistinctAuthors(
      staffMessagesSnap.docs.map((d) => (d.data() as { authorId?: string }).authorId ?? null),
    );

    return {
      eventId,
      scanRate,
      queueEstimate,
      noShowEstimate,
      staffOnline,
      incidentsByStatus: {
        open: incidentsOpen,
        triaged: incidentsTriaged,
        in_progress: incidentsInProgress,
      },
      computedAt: now.toISOString(),
    };
  }
}

// ─── Pure helpers (exported for tests) ───────────────────────────────────

async function safeCount(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    process.stderr.write(
      `[live-stats] count failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 0;
  }
}

/**
 * Bucket a list of ISO timestamps into 1-minute slots over the last
 * `windowMinutes`. Returns an array of length `windowMinutes`,
 * oldest → newest, every entry shaped `{ at, count }`. Empty buckets
 * are zero-filled so the UI sparkline has a fixed-length series.
 */
export function bucketScanRate(
  timestamps: ReadonlyArray<string | null>,
  now: Date,
  windowMinutes: number,
): Array<{ at: string; count: number }> {
  const out: Array<{ at: string; count: number }> = [];
  // Floor `now` to the next minute boundary so the bucket alignment
  // matches the wall clock.
  const flooredNowMs = Math.floor(now.getTime() / ONE_MIN_MS) * ONE_MIN_MS;
  const windowStartMs = flooredNowMs - (windowMinutes - 1) * ONE_MIN_MS;

  // Pre-fill empty buckets.
  for (let i = 0; i < windowMinutes; i++) {
    out.push({
      at: new Date(windowStartMs + i * ONE_MIN_MS).toISOString(),
      count: 0,
    });
  }

  for (const iso of timestamps) {
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) continue;
    const bucketIndex = Math.floor((ms - windowStartMs) / ONE_MIN_MS);
    if (bucketIndex < 0 || bucketIndex >= windowMinutes) continue;
    out[bucketIndex].count += 1;
  }
  return out;
}

export function countDistinctAuthors(authorIds: ReadonlyArray<string | null>): number {
  const set = new Set<string>();
  for (const id of authorIds) {
    if (id) set.add(id);
  }
  return set.size;
}

/**
 * No-show estimate: when `event.endDate` has passed, every confirmed
 * registration that wasn't checked in is a no-show. Before the event
 * ends, the heuristic is "0" — we don't penalise late arrivals
 * mid-event.
 */
export function computeNoShowEstimate(
  event: { endDate?: string | null },
  registeredCount: number,
  checkedInCount: number,
  now: Date,
): number {
  if (!event.endDate) return 0;
  const ended = new Date(event.endDate).getTime() < now.getTime();
  if (!ended) return 0;
  return Math.max(0, registeredCount - checkedInCount);
}

export const liveStatsService = new LiveStatsService();
