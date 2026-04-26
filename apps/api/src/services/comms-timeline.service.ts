/**
 * Organizer overhaul — Phase O5.
 *
 * Aggregates an event's communications into a chronological timeline
 * for the new Comms Center. The timeline answers a different question
 * from `listBroadcasts(eventId)` — instead of "what was sent to whom"
 * it shows "what is going to land in the participant's inbox / phone
 * over the next two weeks", with one row per channel × broadcast.
 *
 * Read-only, safe to poll. The route exposing this aggregation lives
 * at `GET /v1/events/:eventId/comms/timeline`.
 *
 * Future iterations may pull from additional sources (lifecycle
 * notifications emitted by Cloud Functions, scheduled emails from
 * Resend) so the response shape is generic enough to absorb them
 * — `kind: "broadcast"` today, more variants later.
 */

import { BaseService } from "./base.service";
import { eventRepository } from "@/repositories/event.repository";
import { broadcastRepository } from "@/repositories/broadcast.repository";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type { Broadcast, BroadcastStatus, CommunicationChannel } from "@teranga/shared-types";

export type CommsTimelineEntryKind = "broadcast";

export interface CommsTimelineEntry {
  id: string;
  /** Broadcast id today; future iterations may add lifecycle ids. */
  sourceId: string;
  kind: CommsTimelineEntryKind;
  /** ISO string — when the entry already left, the actual send time;
   *  when it's still scheduled, the planned `scheduledAt`. */
  at: string;
  /** Per-channel split — one timeline ROW per (broadcast, channel). */
  channel: CommunicationChannel;
  status: BroadcastStatus;
  title: string;
  /** Truncated body, capped at 240 chars for chart legibility. */
  preview: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
}

export interface CommsTimelineResponse {
  /** Ordered ascending by `at`. */
  entries: CommsTimelineEntry[];
  /** Earliest `at` in the result — convenient for the chart's X axis floor. */
  rangeStart: string | null;
  /** Latest `at` in the result. */
  rangeEnd: string | null;
  computedAt: string;
}

class CommsTimelineService extends BaseService {
  async getEventTimeline(eventId: string, user: AuthUser): Promise<CommsTimelineResponse> {
    this.requirePermission(user, "broadcast:read");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // We pull a generous page size (the timeline is supposed to show
    // ALL comms for the event) — capped at 200 because beyond that
    // the gantt chart becomes unreadable anyway.
    const result = await broadcastRepository.findByEvent(eventId, {}, { page: 1, limit: 200 });

    const entries: CommsTimelineEntry[] = [];
    for (const broadcast of result.data) {
      for (const entry of broadcastToEntries(broadcast)) {
        entries.push(entry);
      }
    }

    entries.sort((a, b) => a.at.localeCompare(b.at));

    return {
      entries,
      rangeStart: entries.length > 0 ? entries[0].at : null,
      rangeEnd: entries.length > 0 ? entries[entries.length - 1].at : null,
      computedAt: new Date().toISOString(),
    };
  }
}

/**
 * Pure helper — explodes one broadcast into N entries (one per
 * channel). Exported for unit testing the geometry independently of
 * the Firestore-bound service.
 */
export function broadcastToEntries(broadcast: Broadcast): CommsTimelineEntry[] {
  const at = broadcast.sentAt ?? broadcast.scheduledAt ?? broadcast.createdAt;
  const preview = broadcast.body.length > 240 ? broadcast.body.slice(0, 237) + "…" : broadcast.body;

  return broadcast.channels.map<CommsTimelineEntry>((channel) => ({
    id: `${broadcast.id}:${channel}`,
    sourceId: broadcast.id,
    kind: "broadcast",
    at,
    channel,
    status: broadcast.status,
    title: broadcast.title,
    preview,
    recipientCount: broadcast.recipientCount,
    sentCount: broadcast.sentCount,
    failedCount: broadcast.failedCount,
  }));
}

export const commsTimelineService = new CommsTimelineService();
