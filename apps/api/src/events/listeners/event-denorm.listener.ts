import { eventBus } from "../event-bus";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { registrationRepository } from "@/repositories/registration.repository";
import { notificationService } from "@/services/notification.service";
import { type Event, type RegistrationStatus } from "@teranga/shared-types";

// ─── Event → Registration denormalization fan-out ───────────────────────────
//
// The Registration schema stores a snapshot of a handful of event fields
// (title, slug, startDate, endDate) so the participant UI can render
// "Mes événements" without a second read per registration. That snapshot
// drifts whenever an organizer edits the event post-registration.
//
// This listener is the server-side source of truth for keeping the
// snapshot in sync. When `event.updated` fires, we:
//
//   1. Detect which of the denormalized fields actually changed.
//   2. Re-fetch the event to read the authoritative post-write values
//      (the `changes` payload is the submitted DTO, which may be
//      normalized inside the service — e.g. venue-derived fields).
//   3. Page through all non-cancelled registrations for the event and
//      rewrite the snapshot in 400-doc batches (Firestore batch cap is
//      500; leave headroom for future fields).
//   4. If the schedule changed (startDate/endDate), send an in-app +
//      push notification to every participant whose registration was
//      rewritten — they need to know the new time.
//
// Design notes:
//   - Fire-and-forget per EventBus contract. A failing fan-out must not
//     affect the HTTP response. Partial failures are logged to stderr
//     and recover on the next `event.updated` (patch is idempotent).
//   - Client-side fallback (reading event.* on render) is still the
//     belt-and-braces for eventually-consistent reads and for historic
//     registrations written before this listener existed.
//   - Cancelled registrations are excluded from the fan-out: they're
//     never displayed and have no user-facing value left to update.

// Keep in sync with RegistrationSchema in packages/shared-types. If you add
// a new denormalized field onto Registration, add the mapping here too or the
// snapshot will drift silently.
const EVENT_TO_REG_FIELD = {
  title: "eventTitle",
  slug: "eventSlug",
  startDate: "eventStartDate",
  endDate: "eventEndDate",
} as const;

type DenormalizedField = keyof typeof EVENT_TO_REG_FIELD;

interface RegistrationDenormPatch {
  eventTitle?: string;
  eventSlug?: string;
  eventStartDate?: string;
  eventEndDate?: string;
}

const FAN_OUT_STATUSES: RegistrationStatus[] = [
  "pending",
  "pending_payment",
  "confirmed",
  "waitlisted",
  "checked_in",
];

const CHUNK_SIZE = 400;

// Notifications are sent in parallel per chunk to bound wall time on
// high-attendance events. 20 concurrent sends keep FCM rate-limit headroom
// while still flushing a 2 000-participant event in ~100 tranches.
const NOTIFY_PARALLELISM = 20;

// Which schedule field(s) moved, used to describe the change accurately
// in the participant notification body.
type ScheduleFieldsChanged = {
  start: boolean;
  end: boolean;
};

// ─── Listener ────────────────────────────────────────────────────────────────

export function registerEventDenormListeners(): void {
  eventBus.on("event.updated", async (payload) => {
    const touched = pickTouchedFields(payload.changes ?? {});
    if (touched.length === 0) return;

    // Re-fetch to read the authoritative, post-write event values. The
    // event may have been normalized inside the service (e.g. venueName
    // resolution) and `payload.changes` only captures the raw submitted
    // DTO, not the stored document.
    const event = await eventRepository.findById(payload.eventId);
    if (!event) return;

    const patch = buildPatch(event, touched);
    if (Object.keys(patch).length === 0) return;

    // event.service.ts#diffChanges guarantees `changes` only carries fields
    // whose value genuinely moved (dates are compared by parsed ms, so
    // format-only re-serialisations are filtered out). By the time we see
    // a touched schedule field here, it is a real move — no need for a
    // magnitude threshold.
    const scheduleFields: ScheduleFieldsChanged = {
      start: touched.includes("startDate"),
      end: touched.includes("endDate"),
    };

    await fanOutToRegistrations(event, patch, scheduleFields);
  });
}

function pickTouchedFields(changes: Record<string, unknown>): DenormalizedField[] {
  return (Object.keys(EVENT_TO_REG_FIELD) as DenormalizedField[]).filter(
    (field) => field in changes && changes[field] !== undefined,
  );
}

function buildPatch(event: Event, touched: DenormalizedField[]): RegistrationDenormPatch {
  const patch: RegistrationDenormPatch = {};
  for (const field of touched) {
    const target = EVENT_TO_REG_FIELD[field];
    const value = event[field];
    if (typeof value === "string") {
      (patch as Record<string, string>)[target] = value;
    }
  }
  return patch;
}

async function fanOutToRegistrations(
  event: Event,
  patch: RegistrationDenormPatch,
  scheduleFields: ScheduleFieldsChanged,
): Promise<void> {
  const notify = scheduleFields.start || scheduleFields.end;
  const body = notify ? buildScheduleBody(event, scheduleFields) : null;

  let lastDoc: FirebaseFirestore.DocumentSnapshot | undefined;
  let hasMore = true;
  let rewritten = 0;
  let notified = 0;

  while (hasMore) {
    const page = await registrationRepository.findByEventCursor(
      event.id,
      FAN_OUT_STATUSES,
      CHUNK_SIZE,
      lastDoc,
    );
    if (page.data.length === 0) break;
    lastDoc = page.lastDoc ?? undefined;
    hasMore = page.data.length === CHUNK_SIZE;

    const batch = db.batch();
    const now = new Date().toISOString();
    const chunkUserIds = new Set<string>();
    for (const reg of page.data) {
      const ref = db.collection(COLLECTIONS.REGISTRATIONS).doc(reg.id);
      batch.update(ref, { ...patch, updatedAt: now });
      rewritten++;
      chunkUserIds.add(reg.userId);
    }

    try {
      await batch.commit();
    } catch (err) {
      process.stderr.write(
        JSON.stringify({
          level: "error",
          msg: "[EventDenormListener] batch commit failed",
          eventId: event.id,
          err: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
      return;
    }

    // Notify per-chunk in bounded parallelism so memory stays flat and
    // participants in the first 400 rows get their push while the later
    // pages are still being scanned.
    if (notify && body) {
      notified += await notifyUsersInParallel(event.id, [...chunkUserIds], body);
    }
  }

  if (rewritten > 0) {
    process.stderr.write(
      JSON.stringify({
        level: "info",
        msg: "[EventDenormListener] fan-out complete",
        eventId: event.id,
        rewritten,
        fields: Object.keys(patch),
        notified,
      }) + "\n",
    );
  }
}

// Build the notification body based on which date fields actually moved.
// Three variants keep the message honest: start-only, end-only, or both.
function buildScheduleBody(event: Event, scheduleFields: ScheduleFieldsChanged): string {
  const fmt = new Intl.DateTimeFormat("fr-SN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Dakar",
  });
  const start = fmt.format(new Date(event.startDate));
  const end = fmt.format(new Date(event.endDate));
  const title = event.title;

  if (scheduleFields.start && scheduleFields.end) {
    return `Les horaires de « ${title} » ont changé. Début : ${start}. Fin : ${end}.`;
  }
  if (scheduleFields.start) {
    return `Les horaires de « ${title} » ont changé. Nouveau début : ${start}.`;
  }
  return `La fin de « ${title} » a été déplacée. Nouvelle fin : ${end}.`;
}

async function notifyUsersInParallel(
  eventId: string,
  userIds: string[],
  body: string,
): Promise<number> {
  const title = "Programme mis à jour";
  let sent = 0;

  for (let i = 0; i < userIds.length; i += NOTIFY_PARALLELISM) {
    const tranche = userIds.slice(i, i + NOTIFY_PARALLELISM);
    const results = await Promise.allSettled(
      tranche.map((userId) =>
        notificationService.send({
          userId,
          type: "event_updated",
          title,
          body,
          data: { eventId, kind: "schedule_change" },
        }),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") sent++;
    }
  }

  return sent;
}
