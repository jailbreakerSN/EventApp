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

    const scheduleChanged = touched.includes("startDate") || touched.includes("endDate");

    await fanOutToRegistrations(event, patch, scheduleChanged);
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
  scheduleChanged: boolean,
): Promise<void> {
  let lastDoc: FirebaseFirestore.DocumentSnapshot | undefined;
  let hasMore = true;
  let rewritten = 0;
  const notifyUserIds = new Set<string>();

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
    for (const reg of page.data) {
      const ref = db.collection(COLLECTIONS.REGISTRATIONS).doc(reg.id);
      batch.update(ref, { ...patch, updatedAt: now });
      rewritten++;
      if (scheduleChanged) notifyUserIds.add(reg.userId);
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
  }

  if (scheduleChanged && notifyUserIds.size > 0) {
    await notifyScheduleChange(event, [...notifyUserIds]);
  }

  if (rewritten > 0) {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        msg: "[EventDenormListener] fan-out complete",
        eventId: event.id,
        rewritten,
        fields: Object.keys(patch),
        notified: scheduleChanged ? notifyUserIds.size : 0,
      }) + "\n",
    );
  }
}

async function notifyScheduleChange(event: Event, userIds: string[]): Promise<void> {
  const formattedDate = new Intl.DateTimeFormat("fr-SN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Dakar",
  }).format(new Date(event.startDate));
  const title = "Programme mis à jour";
  const body = `Les horaires de « ${event.title} » ont changé. Nouveau début : ${formattedDate}.`;

  for (const userId of userIds) {
    try {
      await notificationService.send({
        userId,
        type: "event_updated",
        title,
        body,
        data: { eventId: event.id, kind: "schedule_change" },
      });
    } catch {
      // One user's notification failure must not block the rest.
    }
  }
}
