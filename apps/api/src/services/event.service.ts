import crypto from "node:crypto";
import {
  type CreateEventDto,
  type UpdateEventDto,
  type CreateTicketTypeDto,
  type UpdateTicketTypeDto,
  type CreateAccessZoneDto,
  type UpdateAccessZoneDto,
  type CloneEventDto,
  type Event,
  type EventStatus,
  type EventCategory,
  type EventSearchQuery,
  type Organization,
} from "@teranga/shared-types";
import {
  eventRepository,
  type EventFilters,
  type EventSearchFilters,
} from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { subscriptionRepository } from "@/repositories/subscription.repository";
import { venueRepository } from "@/repositories/venue.repository";
import { PLAN_LIMITS, PLAN_LIMIT_UNLIMITED, isAdminSystemRole } from "@teranga/shared-types";
import { type PaginationParams, type PaginatedResult } from "@/repositories/base.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ForbiddenError, NotFoundError, ValidationError, PlanLimitError } from "@/errors/app-error";
import { db } from "@/config/firebase";
import { COLLECTIONS } from "@/config/firebase";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { generateEventKid } from "./qr-signing";
import { generateOccurrences } from "./recurrence.service";

// ─── Slug generation ─────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function generateSlug(title: string): string {
  const base = slugify(title);
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 hex chars
  return `${base}-${suffix}`;
}

// Date fields that should be compared by parsed-milliseconds rather than
// string identity. A PATCH that re-serializes the same instant (e.g.
// `2026-06-01T09:00:00Z` vs `2026-06-01T09:00:00.000Z`) would otherwise
// look like a change and trigger a needless fan-out + schedule-change
// push notification.
const DATE_FIELDS = new Set(["startDate", "endDate"]);

// Shallow-diff the submitted DTO against the stored event. Returns only
// keys whose submitted value is defined AND differs from the stored value.
// Used by update() to build a minimal `event.updated` domain-event payload
// so downstream listeners don't react to no-op PATCHes.
//
// Date fields use millisecond comparison (see DATE_FIELDS). Other fields
// use strict inequality — nested objects like `location` are compared by
// reference so a fresh object with identical fields still counts as a
// change. That's a conscious trade-off: we'd rather over-fire on a
// nested-object PATCH than miss a real change to a free-text field.
function diffChanges(
  previous: Record<string, unknown>,
  submitted: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(submitted)) {
    if (value === undefined) continue;
    if (DATE_FIELDS.has(key)) {
      const a = typeof value === "string" ? Date.parse(value) : NaN;
      const b = typeof previous[key] === "string" ? Date.parse(previous[key] as string) : NaN;
      if (!Number.isNaN(a) && !Number.isNaN(b) && a === b) continue;
    }
    if (previous[key] !== value) out[key] = value;
  }
  return out;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class EventService extends BaseService {
  async create(dto: CreateEventDto, user: AuthUser): Promise<Event> {
    this.requirePermission(user, "event:create");

    // Verify organization exists and user belongs to it
    const org = await organizationRepository.findByIdOrThrow(dto.organizationId);
    if (user.organizationId !== org.id && !user.roles.some(isAdminSystemRole)) {
      throw new ForbiddenError("Vous ne faites pas partie de cette organisation");
    }

    // Validate dates
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new ValidationError("La date de fin doit être postérieure à la date de début");
    }

    // ── Recurring branch (Phase 7+ item #B1) ────────────────────────────
    // If the payload carries a recurrenceRule, expand it + create one
    // parent + N children in a single transaction. The parent is the
    // "anchor" returned to the caller (its `id` is the series id).
    // Otherwise: unchanged single-event path below.
    if (dto.recurrenceRule) {
      return this.createSeries(dto, org, user);
    }

    // Check plan limit for active events
    await this.checkEventLimit(org);

    const slug = generateSlug(dto.title);

    // Resolve venue if provided
    let venueName: string | null = null;
    if (dto.venueId) {
      const venue = await venueRepository.findByIdOrThrow(dto.venueId);
      if (venue.status !== "approved") {
        throw new ValidationError("Le lieu sélectionné n'est pas approuvé");
      }
      venueName = venue.name;
    }

    const event = await eventRepository.create({
      ...dto,
      slug,
      venueName: venueName ?? dto.venueName ?? null,
      registeredCount: 0,
      checkedInCount: 0,
      // Mint a fresh v4 signing-key id at event create. All newly-issued
      // badges for this event will sign with HKDF(QR_MASTER, eventId, kid);
      // rotation replaces `qrKid` and pushes the old value to
      // `qrKidHistory` so already-issued badges keep verifying through
      // the overlap window.
      qrKid: generateEventKid(),
      qrKidHistory: [],
      // Default to single-scan semantics. Organizers flip to
      // multi_zone / multi_day post-create via `EventService.setScanPolicy`
      // (shipping next commit).
      scanPolicy: "single",
      createdBy: user.uid,
      updatedBy: user.uid,
      publishedAt: null,
    } as Omit<Event, "id" | "createdAt" | "updatedAt">);

    // Increment venue event counter
    if (dto.venueId) {
      await venueRepository.increment(dto.venueId, "eventCount", 1);
    }

    eventBus.emit("event.created", {
      event,
      organizationId: dto.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return event;
  }

  /**
   * Recurring-series create path. Generates N occurrences, validates plan
   * quota against the full fan-out, then writes parent + children in a
   * single Firestore transaction.
   *
   * Atomicity: Firestore transactions cap at 500 writes per commit. The
   * MVP hard-limits occurrences to 52 (RECURRENCE_MAX_OCCURRENCES), so
   * 1 parent + 52 children = 53 writes — well under the 500 budget. If
   * a future expansion bumps the cap, split into a batched write or an
   * idempotent worker.
   */
  private async createSeries(
    dto: CreateEventDto,
    org: Organization,
    user: AuthUser,
  ): Promise<Event> {
    const rule = dto.recurrenceRule!;

    // Expand occurrences first (cheap, pure). Fail fast on bad input.
    const occurrences = generateOccurrences(
      dto.startDate,
      dto.endDate,
      rule,
      dto.timezone ?? "Africa/Dakar",
    );

    // Plan-quota check against the FULL write fan-out: 1 parent + N children.
    // The parent is an anchor doc that lives in the `events` collection and
    // IS counted by `countActiveByOrganization`, so quota math must include
    // it — otherwise a free-tier org (maxEvents: 3) creating a series of
    // count=3 writes 4 docs and silently overshoots. `checkEventLimit` also
    // carries the scheduled-downgrade freeze; we reuse the helper instead
    // of inlining `checkPlanLimit` to avoid regressing that guardrail.
    await this.checkEventLimit(org, occurrences.length + 1);

    // Resolve venue once — applies to every occurrence.
    let venueName: string | null = null;
    if (dto.venueId) {
      const venue = await venueRepository.findByIdOrThrow(dto.venueId);
      if (venue.status !== "approved") {
        throw new ValidationError("Le lieu sélectionné n'est pas approuvé");
      }
      venueName = venue.name;
    }

    const now = new Date().toISOString();
    const parentRef = db.collection(COLLECTIONS.EVENTS).doc();
    const parentId = parentRef.id;
    const parentSlug = generateSlug(dto.title);

    // Build child payloads — one per occurrence. Each child is a full
    // Event doc: own id, own slug, own qrKid, own registeredCount. Only
    // startDate/endDate + parentEventId + occurrenceIndex differ.
    const childRefs: FirebaseFirestore.DocumentReference[] = [];
    const childPayloads: Array<Omit<Event, "createdAt" | "updatedAt">> = [];
    for (const occ of occurrences) {
      const childRef = db.collection(COLLECTIONS.EVENTS).doc();
      childRefs.push(childRef);
      childPayloads.push({
        ...dto,
        id: childRef.id,
        // Slug per occurrence to avoid collisions; suffix keeps the base
        // searchable under the same stem.
        slug: `${parentSlug}-${occ.index + 1}`,
        startDate: occ.startDate,
        endDate: occ.endDate,
        venueName: venueName ?? dto.venueName ?? null,
        registeredCount: 0,
        checkedInCount: 0,
        qrKid: generateEventKid(),
        qrKidHistory: [],
        scanPolicy: "single",
        status: "draft",
        createdBy: user.uid,
        updatedBy: user.uid,
        publishedAt: null,
        isRecurringParent: false,
        parentEventId: parentId,
        occurrenceIndex: occ.index,
        recurrenceRule: rule, // echoed for convenience; children don't regenerate
      } as Omit<Event, "createdAt" | "updatedAt">);
    }

    // Parent payload — anchor doc, invisible to participants until the
    // organizer publishes the series.
    const parentPayload: Omit<Event, "createdAt" | "updatedAt"> = {
      ...dto,
      id: parentId,
      slug: parentSlug,
      venueName: venueName ?? dto.venueName ?? null,
      registeredCount: 0,
      checkedInCount: 0,
      qrKid: generateEventKid(),
      qrKidHistory: [],
      scanPolicy: "single",
      status: "draft",
      createdBy: user.uid,
      updatedBy: user.uid,
      publishedAt: null,
      isRecurringParent: true,
      parentEventId: null,
      occurrenceIndex: null,
      recurrenceRule: rule,
    } as Omit<Event, "createdAt" | "updatedAt">;

    await db.runTransaction(async (tx) => {
      tx.set(parentRef, { ...parentPayload, createdAt: now, updatedAt: now });
      for (let i = 0; i < childRefs.length; i += 1) {
        tx.set(childRefs[i], { ...childPayloads[i], createdAt: now, updatedAt: now });
      }
    });

    // Venue counter bump runs outside the tx to keep the atomicity
    // boundary focused on the series writes. +1 per occurrence +1 for
    // the parent — matches `maxEvents` enforcement above.
    if (dto.venueId) {
      await venueRepository.increment(
        dto.venueId,
        "eventCount",
        occurrences.length + 1,
      );
    }

    const parentEvent: Event = {
      ...parentPayload,
      createdAt: now,
      updatedAt: now,
    } as Event;

    eventBus.emit("event.series_created", {
      parentEventId: parentId,
      occurrenceCount: occurrences.length,
      organizationId: org.id,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    // Also emit a plain event.created for the parent so existing audit +
    // dashboards keep working. Listeners can filter on
    // isRecurringParent=true if they want to suppress the noise.
    eventBus.emit("event.created", {
      event: parentEvent,
      organizationId: org.id,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return parentEvent;
  }

  /**
   * Publish an entire series: parent + every child atomically. Children
   * are looked up via `parentEventId === parent.id`. Each child gets
   * `status: "published"` + `publishedAt` = now. Partial failure is
   * prevented by wrapping the reads + writes in a single transaction.
   *
   * If the series has more than ~250 children the transaction will
   * exceed Firestore's 500-write budget — the MVP caps at 52 so we
   * never hit that. A future expansion would need a batched approach.
   */
  async publishSeries(parentEventId: string, user: AuthUser): Promise<{
    parentEventId: string;
    publishedCount: number;
  }> {
    this.requirePermission(user, "event:publish");

    const parent = await eventRepository.findByIdOrThrow(parentEventId);
    if (!parent.isRecurringParent) {
      throw new ValidationError(
        "Cet événement n'est pas le parent d'une série — utilisez la publication classique.",
      );
    }
    this.requireOrganizationAccess(user, parent.organizationId);

    const children = await db
      .collection(COLLECTIONS.EVENTS)
      .where("parentEventId", "==", parentEventId)
      .get();

    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      // The parent is an organizational anchor, not a real registerable
      // event. We flip its `publishedAt` (for audit/history) but KEEP
      // `status: "draft"` so it never appears on participant discovery
      // surfaces — doubling up the public filter with
      // `status !== "published"` on parents is defense-in-depth against
      // a future index change accidentally leaking parents.
      tx.update(db.collection(COLLECTIONS.EVENTS).doc(parentEventId), {
        publishedAt: now,
        updatedAt: now,
        updatedBy: user.uid,
      });
      for (const doc of children.docs) {
        tx.update(doc.ref, {
          status: "published",
          publishedAt: now,
          updatedAt: now,
          updatedBy: user.uid,
        });
      }
    });

    eventBus.emit("event.series_published", {
      parentEventId,
      organizationId: parent.organizationId,
      publishedCount: children.size,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return { parentEventId, publishedCount: children.size };
  }

  async getById(eventId: string, user?: AuthUser): Promise<Event> {
    const event = await eventRepository.findByIdOrThrow(eventId);

    // Published public events are visible to everyone
    if (event.status === "published" && event.isPublic) return event;

    // Non-public or draft events require authentication + org membership
    if (!user) throw new ForbiddenError("Authentification requise pour voir cet événement");
    this.requirePermission(user, "event:read");
    this.requireOrganizationAccess(user, event.organizationId);

    return event;
  }

  async getBySlug(slug: string, user?: AuthUser): Promise<Event> {
    // Try strict slug lookup first, then fall back to ID lookup so links
    // built from `event.id` (e.g. historical registrations that predate
    // the eventSlug denormalization) still resolve to the right event
    // instead of 404'ing.
    let event = await eventRepository.findBySlug(slug);
    if (!event) {
      event = await eventRepository.findById(slug);
    }
    if (!event) {
      const { NotFoundError } = await import("@/errors/app-error");
      throw new NotFoundError("Event", slug);
    }

    // Same visibility logic as getById
    if (event.status === "published" && event.isPublic) return event;

    if (!user) throw new ForbiddenError("Authentification requise pour voir cet événement");
    this.requirePermission(user, "event:read");
    this.requireOrganizationAccess(user, event.organizationId);

    return event;
  }

  async listPublished(
    filters: EventFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<Event>> {
    return eventRepository.findPublished(filters, pagination);
  }

  async listByOrganization(
    organizationId: string,
    user: AuthUser,
    pagination: PaginationParams,
    filters: { category?: EventCategory; status?: EventStatus } = {},
  ): Promise<PaginatedResult<Event>> {
    this.requirePermission(user, "event:read");

    if (user.organizationId !== organizationId && !user.roles.some(isAdminSystemRole)) {
      throw new ForbiddenError("Accès refusé aux événements de cette organisation");
    }

    return eventRepository.findByOrganization(organizationId, pagination, filters);
  }

  async update(eventId: string, dto: UpdateEventDto, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Cannot update cancelled/archived events
    if (event.status === "cancelled" || event.status === "archived") {
      throw new ValidationError(`Cannot update an event with status '${event.status}'`);
    }

    // Validate dates if both are provided or one changes
    const startDate = dto.startDate ?? event.startDate;
    const endDate = dto.endDate ?? event.endDate;
    if (new Date(endDate) <= new Date(startDate)) {
      throw new ValidationError("La date de fin doit être postérieure à la date de début");
    }

    // Handle venue change
    const updateData: Partial<Event> & Record<string, unknown> = {
      ...dto,
      updatedBy: user.uid,
    };

    if (dto.venueId !== undefined && dto.venueId !== event.venueId) {
      if (dto.venueId) {
        // New venue assigned
        const venue = await venueRepository.findByIdOrThrow(dto.venueId);
        if (venue.status !== "approved") {
          throw new ValidationError("Le lieu sélectionné n'est pas approuvé");
        }
        updateData.venueName = venue.name;
        await venueRepository.increment(dto.venueId, "eventCount", 1);
      } else {
        // Venue removed
        updateData.venueName = null;
      }
      // Decrement old venue counter
      if (event.venueId) {
        await venueRepository.increment(event.venueId, "eventCount", -1);
      }
    }

    await eventRepository.update(eventId, updateData as Partial<Event>);

    // Diff the submitted DTO against the pre-write event so only genuinely-
    // changed fields land on the domain event. Downstream listeners (denorm
    // fan-out, audit, schedule-change notifications) key off this payload;
    // re-posting an unchanged value would otherwise trigger a no-op write
    // fan-out across every registration and a spurious "schedule updated"
    // push to every participant.
    const changes = diffChanges(event, dto);
    if (Object.keys(changes).length > 0) {
      const nowIso = new Date().toISOString();
      eventBus.emit("event.updated", {
        eventId,
        organizationId: event.organizationId,
        changes,
        actorId: user.uid,
        requestId: getRequestId(),
        timestamp: nowIso,
      });

      // Rescheduled = startDate, endDate, or location changed. Fires as
      // a distinct domain event so the notification dispatcher can
      // route to the `event.rescheduled` template without inspecting
      // the diff, and so the audit trail has a dedicated action code
      // for the "organizer changed the time/place" query. `event.updated`
      // still fires above for generic audit / denorm fan-out.
      const startChanged = "startDate" in changes;
      const endChanged = "endDate" in changes;
      const locationChanged = "location" in changes;
      if (startChanged || endChanged || locationChanged) {
        const prevLocationStr = event.location
          ? [event.location.name, event.location.city, event.location.country]
              .filter(Boolean)
              .join(", ")
          : undefined;
        const nextLocationRaw = (changes as Record<string, unknown>).location ?? event.location;
        const nextLocationObj =
          nextLocationRaw && typeof nextLocationRaw === "object"
            ? (nextLocationRaw as { name?: string; city?: string; country?: string })
            : null;
        const nextLocationStr = nextLocationObj
          ? [nextLocationObj.name, nextLocationObj.city, nextLocationObj.country]
              .filter(Boolean)
              .join(", ")
          : undefined;
        eventBus.emit("event.rescheduled", {
          eventId,
          organizationId: event.organizationId,
          previousStartDate: event.startDate,
          newStartDate: startChanged
            ? ((changes as Record<string, string>).startDate ?? event.startDate)
            : event.startDate,
          ...(endChanged
            ? {
                previousEndDate: event.endDate,
                newEndDate: (changes as Record<string, string>).endDate,
              }
            : {}),
          ...(locationChanged
            ? {
                previousLocation: prevLocationStr,
                newLocation: nextLocationStr,
              }
            : {}),
          actorId: user.uid,
          requestId: getRequestId(),
          timestamp: nowIso,
        });
      }
    }
  }

  async publish(eventId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:publish");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    if (event.status !== "draft") {
      throw new ValidationError(
        `Cannot publish event with status '${event.status}'. Only draft events can be published.`,
      );
    }

    // Validate event is ready for publishing
    if (!event.title || !event.startDate || !event.endDate || !event.location) {
      throw new ValidationError(
        "L'événement doit avoir un titre, des dates et un lieu avant publication",
      );
    }

    await eventRepository.publish(eventId, user.uid);

    // Re-fetch to get full published state for the event payload
    const published = await eventRepository.findByIdOrThrow(eventId);
    eventBus.emit("event.published", {
      event: published,
      organizationId: event.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  async cancel(eventId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    if (event.status === "cancelled" || event.status === "archived") {
      throw new ValidationError(`Event is already ${event.status}`);
    }

    await eventRepository.update(eventId, {
      status: "cancelled" as EventStatus,
      updatedBy: user.uid,
    } as Partial<Event>);

    eventBus.emit("event.cancelled", {
      eventId,
      organizationId: event.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Sprint-2 S1 closure — cancel an entire recurring-event series in
   * one atomic operation. Flips the parent + every child to
   * `status: "cancelled"` inside a single Firestore transaction so a
   * partial failure can't leave the series in mixed state.
   *
   * Refuses to operate on non-parent docs (use `cancel` for individual
   * events). Children that are already cancelled / archived are
   * left untouched — the existing state-machine guards in the per-
   * event flow stay authoritative.
   *
   * Per CLAUDE.md, the 500-write transaction budget caps us at ~250
   * children. The recurring-events MVP already enforces a 52-
   * occurrence ceiling so we're well below the budget.
   */
  async cancelSeries(
    parentEventId: string,
    user: AuthUser,
  ): Promise<{ parentEventId: string; cancelledCount: number }> {
    this.requirePermission(user, "event:update");

    const parent = await eventRepository.findByIdOrThrow(parentEventId);
    if (!parent.isRecurringParent) {
      throw new ValidationError(
        "Cet événement n'est pas le parent d'une série — utilisez l'annulation classique.",
      );
    }
    this.requireOrganizationAccess(user, parent.organizationId);

    const now = new Date().toISOString();
    let cancelledCount = 0;
    const cancelledChildIds: string[] = [];

    // Sprint-2 review fix — children collection read MUST be inside
    // the transaction so a child created or status-flipped between
    // the read and the writes can't be silently missed. Firestore
    // doesn't support `query.get()` directly on a `Transaction` —
    // we use the standard pattern of `tx.get(query)` which re-reads
    // the matching docs at transaction-commit time. The 500-write
    // budget is bounded by the recurring-events 52-occurrence cap.
    await db.runTransaction(async (tx) => {
      const childrenSnap = await tx.get(
        db.collection(COLLECTIONS.EVENTS).where("parentEventId", "==", parentEventId),
      );

      // Always flip the parent (even if it's `draft` — the anchor
      // doc never went public anyway, but cancelling it makes the
      // intent explicit in the audit log).
      tx.update(db.collection(COLLECTIONS.EVENTS).doc(parentEventId), {
        status: "cancelled" as EventStatus,
        updatedAt: now,
        updatedBy: user.uid,
      });

      for (const doc of childrenSnap.docs) {
        const child = doc.data() as Event;
        if (child.status === "cancelled" || child.status === "archived") continue;
        tx.update(doc.ref, {
          status: "cancelled" as EventStatus,
          updatedAt: now,
          updatedBy: user.uid,
        });
        cancelledChildIds.push(doc.id);
      }
      cancelledCount = cancelledChildIds.length;
    });

    // One aggregate event for the whole series — keeps audit
    // dashboards from getting blasted with N rows for a single
    // operator action. Per-child cancel events are NOT emitted
    // since the bulk path is the canonical record. Listeners
    // that care about per-child cleanup (refunds, notifications)
    // can subscribe to `event.series_cancelled` and fan out from
    // the included `cancelledChildIds` list.
    eventBus.emit("event.series_cancelled", {
      parentEventId,
      organizationId: parent.organizationId,
      cancelledCount,
      cancelledChildIds,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return { parentEventId, cancelledCount };
  }

  /**
   * Rotate the event's QR signing key id. Used when a staff device has
   * been lost or a key is suspected compromised.
   *
   * Effect:
   *   - Mint a new `qrKid`. Push the old value to `qrKidHistory` with
   *     a `retiredAt` stamp so already-issued badges keep verifying
   *     through the rotation window.
   *   - Newly-issued registrations (via `registrationService.register` /
   *     `paymentService.initiatePayment`) will sign with the new key.
   *   - Existing badges are NOT re-signed; their payload carries the
   *     retired `kid` and the resolver resolves it via `qrKidHistory`.
   *   - A hard "event compromised" flow would clear `qrKidHistory` and
   *     re-seal all active registrations — left as operator-driven
   *     follow-up, not automatic on this rotation.
   *
   * Transactional so two concurrent rotation requests can't each read
   * the same `qrKid`, each push it to history, and each write — the
   * second would silently drop the first rotation's history entry.
   * The read + write must land in one snapshot.
   */
  async rotateQrKey(eventId: string, user: AuthUser): Promise<{ qrKid: string }> {
    this.requirePermission(user, "event:update");

    const result = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      const newKid = generateEventKid();
      const previousKid = event.qrKid ?? null;
      const history = [...(event.qrKidHistory ?? [])];
      if (previousKid) {
        history.push({ kid: previousKid, retiredAt: new Date().toISOString() });
      }

      tx.update(docRef, {
        qrKid: newKid,
        qrKidHistory: history,
        updatedBy: user.uid,
        updatedAt: new Date().toISOString(),
      });

      return { newKid, previousKid, organizationId: event.organizationId };
    });

    // Dedicated event name so `auditLogs` distinguishes a key rotation
    // from a generic event edit. Listener writes `action:
    // "event.qr_key_rotated"` with `{ newKid, previousKid }` details —
    // post-event forensics can query "who rotated this event's key,
    // when" by action name alone.
    eventBus.emit("event.qr_key_rotated", {
      eventId,
      organizationId: result.organizationId,
      newKid: result.newKid,
      previousKid: result.previousKid,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return { qrKid: result.newKid };
  }

  /**
   * Flip the event's `scanPolicy`. Enables `multi_day` (once per
   * participant per day in the event's timezone) or `multi_zone`
   * (once per participant per access zone) without forcing the
   * organizer to recreate the event. Default post-create stays
   * `"single"`.
   *
   * Transactional so the read + write land in one snapshot — prevents
   * two concurrent flips from oscillating the field.
   */
  async setScanPolicy(
    eventId: string,
    policy: "single" | "multi_day" | "multi_zone",
    user: AuthUser,
  ): Promise<{ scanPolicy: "single" | "multi_day" | "multi_zone" }> {
    this.requirePermission(user, "event:update");

    const result = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      // Multi-entry scan policies (multi_day, multi_zone) are a paid
      // feature — gate behind `advancedAnalytics` (pro+). "single" is
      // always available so free / starter orgs can never get stuck
      // if they mis-configured an event before downgrading.
      if (policy !== "single") {
        const org = await organizationRepository.findByIdOrThrow(event.organizationId);
        this.requirePlanFeature(org, "advancedAnalytics");
      }

      const previous = event.scanPolicy ?? "single";
      if (previous === policy) {
        // No-op: don't stamp updatedAt on a noise edit.
        return { previous, organizationId: event.organizationId, changed: false };
      }

      tx.update(docRef, {
        scanPolicy: policy,
        updatedBy: user.uid,
        updatedAt: new Date().toISOString(),
      });

      return { previous, organizationId: event.organizationId, changed: true };
    });

    if (result.changed) {
      // Use the generic `event.updated` channel — policy flips aren't
      // frequent enough to warrant their own action code, and
      // `changes.scanPolicy` is enough for the audit query.
      eventBus.emit("event.updated", {
        eventId,
        organizationId: result.organizationId,
        changes: { scanPolicy: policy, previousScanPolicy: result.previous },
        actorId: user.uid,
        requestId: getRequestId(),
        timestamp: new Date().toISOString(),
      });
    }

    return { scanPolicy: policy };
  }

  async archive(eventId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:delete");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // T2.2 closure — capture `archivedAt` so the admin "Restaurer"
    // flow can enforce a 30-day undo window. `softDelete` only
    // updates the status; we patch in the timestamp via a single
    // direct repo update to keep the change atomic with the status
    // flip.
    const now = new Date().toISOString();
    await eventRepository.update(eventId, {
      status: "archived",
      archivedAt: now,
    } as Partial<Event>);

    eventBus.emit("event.archived", {
      eventId,
      organizationId: event.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });
  }

  /**
   * T2.2 closure — undo a recent archive. An event is restorable when:
   *  - its current `status` is `"archived"`, AND
   *  - its `archivedAt` timestamp is within the last 30 days
   *
   * Restored events return to `status: "draft"` (not the previous
   * `"published"` state) so an organizer must consciously re-publish
   * before participants see it again. This avoids surprise
   * re-availability on the public discovery surface.
   *
   * Permission gate: same as archive (`event:delete`) — anyone who
   * could archive can undo their own action. Org access enforced.
   * `cancelled` events are NOT restorable: cancellation is a stronger
   * end-state with downstream side effects (refunds, notifications).
   */
  async restore(eventId: string, user: AuthUser): Promise<{ eventId: string }> {
    this.requirePermission(user, "event:delete");

    // Pre-load the event for access + plan-limit checks. The
    // authoritative state is re-read INSIDE the transaction below
    // so a concurrent mutation between the pre-load and the commit
    // can't slip through (T2.2 review fix — TOCTOU race on
    // `status` between the pre-check and the write).
    const preloaded = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, preloaded.organizationId);

    // T2.2 plan-limit fix — restoring brings the event back to a
    // status that counts against `maxEvents`. An organizer who
    // archived to free a slot, then created a new event, then
    // restored the old one would otherwise overshoot the cap.
    // Mirrors `create` / `clone` exactly.
    const org = await organizationRepository.findByIdOrThrow(preloaded.organizationId);
    await this.checkEventLimit(org);

    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const ref = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError("event", eventId);
      const fresh = snap.data() as Event;

      if (fresh.status !== "archived") {
        throw new ValidationError(
          "Seuls les événements archivés peuvent être restaurés.",
        );
      }
      if (!fresh.archivedAt) {
        // Legacy events archived before T2.2 don't carry the
        // timestamp. Refuse rather than guess.
        throw new ValidationError(
          "Cet événement a été archivé avant l'introduction de la fenêtre de restauration. Veuillez le recréer manuellement si nécessaire.",
        );
      }
      const archivedAtMs = new Date(fresh.archivedAt).getTime();
      const ageMs = Date.now() - archivedAtMs;
      const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
      if (ageMs > RESTORE_WINDOW_MS) {
        const daysAgo = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        throw new ValidationError(
          `Fenêtre de restauration dépassée (archivé il y a ${daysAgo} jours, limite 30 jours).`,
        );
      }

      tx.update(ref, {
        status: "draft",
        archivedAt: null,
        updatedAt: now,
        updatedBy: user.uid,
      });
    });

    eventBus.emit("event.restored", {
      eventId,
      organizationId: preloaded.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return { eventId };
  }

  async unpublish(eventId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:publish");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    if (event.status !== "published") {
      throw new ValidationError(
        `Cannot unpublish event with status '${event.status}'. Only published events can be unpublished.`,
      );
    }

    await eventRepository.unpublish(eventId, user.uid);

    eventBus.emit("event.unpublished", {
      eventId,
      organizationId: event.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Ticket Type Management ──────────────────────────────────────────────

  async addTicketType(eventId: string, dto: CreateTicketTypeDto, user: AuthUser): Promise<Event> {
    this.requirePermission(user, "event:update");

    const ticketId = `tt-${crypto.randomBytes(4).toString("hex")}`;
    const newTicketType = { ...dto, id: ticketId, soldCount: 0 };

    const updatedEvent = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      if (event.status === "cancelled" || event.status === "archived") {
        throw new ValidationError(`Cannot modify ticket types on a ${event.status} event`);
      }

      // Gate paid tickets behind plan feature
      if (dto.price && dto.price > 0) {
        const org = await organizationRepository.findByIdOrThrow(event.organizationId);
        this.requirePlanFeature(org, "paidTickets");
      }

      const updatedTicketTypes = [...event.ticketTypes, newTicketType];
      tx.update(docRef, { ticketTypes: updatedTicketTypes, updatedBy: user.uid });
      return { ...event, ticketTypes: updatedTicketTypes };
    });

    eventBus.emit("ticket_type.added", {
      eventId,
      organizationId: updatedEvent.organizationId,
      ticketTypeId: ticketId,
      ticketTypeName: dto.name,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return updatedEvent;
  }

  async updateTicketType(
    eventId: string,
    ticketTypeId: string,
    dto: UpdateTicketTypeDto,
    user: AuthUser,
  ): Promise<Event> {
    this.requirePermission(user, "event:update");

    const updatedEvent = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      const index = event.ticketTypes.findIndex((t) => t.id === ticketTypeId);
      if (index === -1) {
        throw new ValidationError(`Type de billet « ${ticketTypeId} » introuvable`);
      }

      const updatedTicketTypes = [...event.ticketTypes];
      const merged = { ...updatedTicketTypes[index], ...dto };
      updatedTicketTypes[index] = merged;

      // Gate paid tickets behind plan feature. Checked against the merged
      // price so raising a free ticket to a paid one — or keeping an
      // existing paid ticket while editing anything else — both trip the
      // gate on free/starter plans.
      if (merged.price > 0) {
        const org = await organizationRepository.findByIdOrThrow(event.organizationId);
        this.requirePlanFeature(org, "paidTickets");
      }

      tx.update(docRef, { ticketTypes: updatedTicketTypes, updatedBy: user.uid });
      return { ...event, ticketTypes: updatedTicketTypes };
    });

    eventBus.emit("ticket_type.updated", {
      eventId,
      organizationId: updatedEvent.organizationId,
      ticketTypeId,
      changes: dto as Record<string, unknown>,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return updatedEvent;
  }

  async removeTicketType(eventId: string, ticketTypeId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const result = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      const ticketType = event.ticketTypes.find((t) => t.id === ticketTypeId);
      if (!ticketType) {
        throw new ValidationError(`Type de billet « ${ticketTypeId} » introuvable`);
      }
      if (ticketType.soldCount > 0) {
        throw new ValidationError(
          "Impossible de supprimer un type de billet avec des ventes existantes",
        );
      }

      const updatedTicketTypes = event.ticketTypes.filter((t) => t.id !== ticketTypeId);
      tx.update(docRef, { ticketTypes: updatedTicketTypes, updatedBy: user.uid });
      return { organizationId: event.organizationId, ticketTypeName: ticketType.name };
    });

    eventBus.emit("ticket_type.removed", {
      eventId,
      organizationId: result.organizationId,
      ticketTypeId,
      ticketTypeName: result.ticketTypeName,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Access Zone Management ──────────────────────────────────────────────

  async addAccessZone(eventId: string, dto: CreateAccessZoneDto, user: AuthUser): Promise<Event> {
    this.requirePermission(user, "event:update");

    const zoneId = `zone-${crypto.randomBytes(4).toString("hex")}`;
    const newZone = { ...dto, id: zoneId };

    const updatedEvent = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      if (event.status === "cancelled" || event.status === "archived") {
        throw new ValidationError(`Cannot modify access zones on a ${event.status} event`);
      }

      const updatedZones = [...event.accessZones, newZone];
      tx.update(docRef, { accessZones: updatedZones, updatedBy: user.uid });
      return { ...event, accessZones: updatedZones };
    });

    eventBus.emit("access_zone.added", {
      eventId,
      organizationId: updatedEvent.organizationId,
      zoneId,
      zoneName: dto.name,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return updatedEvent;
  }

  async updateAccessZone(
    eventId: string,
    zoneId: string,
    dto: UpdateAccessZoneDto,
    user: AuthUser,
  ): Promise<Event> {
    this.requirePermission(user, "event:update");

    const updatedEvent = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      const index = event.accessZones.findIndex((z) => z.id === zoneId);
      if (index === -1) {
        throw new ValidationError(`Access zone '${zoneId}' not found`);
      }

      const updatedZones = [...event.accessZones];
      updatedZones[index] = { ...updatedZones[index], ...dto };
      tx.update(docRef, { accessZones: updatedZones, updatedBy: user.uid });
      return { ...event, accessZones: updatedZones };
    });

    eventBus.emit("access_zone.updated", {
      eventId,
      organizationId: updatedEvent.organizationId,
      zoneId,
      changes: dto as Record<string, unknown>,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return updatedEvent;
  }

  async removeAccessZone(eventId: string, zoneId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const result = await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        const { NotFoundError } = await import("@/errors/app-error");
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: snap.id, ...snap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      const zone = event.accessZones.find((z) => z.id === zoneId);
      if (!zone) {
        throw new ValidationError(`Access zone '${zoneId}' not found`);
      }

      const updatedZones = event.accessZones.filter((z) => z.id !== zoneId);
      tx.update(docRef, { accessZones: updatedZones, updatedBy: user.uid });
      return { organizationId: event.organizationId, zoneName: zone.name };
    });

    eventBus.emit("access_zone.removed", {
      eventId,
      organizationId: result.organizationId,
      zoneId,
      zoneName: result.zoneName,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Clone Event ─────────────────────────────────────────────────────────

  async clone(eventId: string, dto: CloneEventDto, user: AuthUser): Promise<Event> {
    this.requirePermission(user, "event:create");

    const source = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, source.organizationId);

    // Check plan limits for event count
    const org = await organizationRepository.findByIdOrThrow(source.organizationId);
    await this.checkEventLimit(org);

    // Validate new dates
    if (new Date(dto.newEndDate) <= new Date(dto.newStartDate)) {
      throw new ValidationError("La date de fin doit être postérieure à la date de début");
    }

    const title = dto.newTitle ?? `${source.title} (copie)`;
    const slug = generateSlug(title);

    // Reset ticket type counters and generate new IDs
    const ticketTypes =
      dto.copyTicketTypes !== false
        ? source.ticketTypes.map((t) => ({
            ...t,
            id: `tt-${crypto.randomBytes(4).toString("hex")}`,
            soldCount: 0,
          }))
        : [];

    const accessZones =
      dto.copyAccessZones !== false
        ? source.accessZones.map((z) => ({
            ...z,
            id: `zone-${crypto.randomBytes(4).toString("hex")}`,
          }))
        : [];

    const cloned = await eventRepository.create({
      organizationId: source.organizationId,
      title,
      slug,
      description: source.description,
      shortDescription: source.shortDescription ?? null,
      coverImageURL: source.coverImageURL ?? null,
      bannerImageURL: source.bannerImageURL ?? null,
      category: source.category,
      tags: source.tags,
      format: source.format,
      status: "draft" as EventStatus,
      location: source.location,
      startDate: dto.newStartDate,
      endDate: dto.newEndDate,
      timezone: source.timezone,
      ticketTypes,
      accessZones,
      maxAttendees: source.maxAttendees ?? null,
      registeredCount: 0,
      checkedInCount: 0,
      // Fresh kid for the cloned event — never reuse the source event's
      // signing key, even if the clone is otherwise identical.
      qrKid: generateEventKid(),
      qrKidHistory: [],
      scanPolicy: source.scanPolicy ?? "single",
      isPublic: source.isPublic,
      isFeatured: false,
      requiresApproval: source.requiresApproval,
      templateId: source.templateId ?? null,
      createdBy: user.uid,
      updatedBy: user.uid,
      publishedAt: null,
    } as Omit<Event, "id" | "createdAt" | "updatedAt">);

    eventBus.emit("event.cloned", {
      sourceEventId: eventId,
      newEventId: cloned.id,
      organizationId: source.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return cloned;
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  async search(query: EventSearchQuery, _user?: AuthUser): Promise<PaginatedResult<Event>> {
    // Normalize tags: accept comma-separated string or array
    const tags = query.tags
      ? Array.isArray(query.tags)
        ? query.tags
        : query.tags.split(",").map((t) => t.trim())
      : undefined;

    const filters: EventSearchFilters = {
      category: query.category,
      format: query.format,
      organizationId: query.organizationId,
      isFeatured: query.isFeatured,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      city: query.city,
      country: query.country,
      tags,
    };

    const result = await eventRepository.search(filters, {
      page: query.page,
      limit: query.limit,
      orderBy: query.orderBy,
      orderDir: query.orderDir,
    });

    // Client-side title prefix filter (Firestore lacks full-text search)
    if (query.q) {
      const q = query.q.toLowerCase();
      result.data = result.data.filter(
        (e) => e.title.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q),
      );
      result.meta.total = result.data.length;
      result.meta.totalPages = Math.ceil(result.data.length / query.limit);
    }

    return result;
  }

  // ─── Plan Limit Helpers ────────────────────────────────────────────────────

  /**
   * @param additionalEvents number of events to pre-add to the current
   * count (defaults to 0 → single-event create path). Series create
   * passes the fan-out (parent + N children) so the quota check models
   * the actual write volume.
   */
  private async checkEventLimit(
    org: Organization,
    additionalEvents: number = 0,
  ): Promise<void> {
    const current = await eventRepository.countActiveByOrganization(org.id);
    const projected = current + additionalEvents;
    const { allowed, limit } = this.checkPlanLimit(org, "events", projected);
    if (!allowed) {
      const planLabel = org.effectivePlanKey ?? org.plan;
      throw new PlanLimitError(`Maximum ${limit} événements actifs sur le plan ${planLabel}`, {
        current: projected,
        max: limit,
        plan: planLabel,
      });
    }

    // ─── Scheduled-downgrade freeze (Q2a, post-audit) ───────────────────
    // If the org has a pending downgrade, honour the TARGET plan's
    // event cap starting immediately — not at `effectiveAt`. Otherwise
    // an organizer can schedule the downgrade, create events above the
    // target's cap, and then the rollover job silently refuses to flip
    // (pre-check sees current > target). Result: org sits in "scheduled
    // downgrade" state permanently, billed at the old plan.
    //
    // Conservative rule: if a downgrade is scheduled, block new event
    // creation as soon as we'd exceed the TARGET plan's cap. Organizers
    // can always revert the scheduled change via
    // `subscriptionService.revertScheduledChange` if they change their
    // mind — no data stranded.
    const sub = await subscriptionRepository.findByOrganization(org.id);
    const target = sub?.scheduledChange?.toPlan;
    if (target && target !== org.plan) {
      // `toPlan` is `z.string()` to accommodate custom plan keys, but
      // the known tiers live in `PLAN_LIMITS`. Narrow to the known set;
      // unknown custom keys fall through — their limits come from the
      // catalog and are already enforced at schedule time.
      const targetPlan =
        target === "free" || target === "starter" || target === "pro" || target === "enterprise"
          ? PLAN_LIMITS[target]
          : undefined;
      if (targetPlan) {
        const targetMaxEvents =
          targetPlan.maxEvents === PLAN_LIMIT_UNLIMITED ? Infinity : targetPlan.maxEvents;
        if (Number.isFinite(targetMaxEvents) && projected >= targetMaxEvents) {
          throw new PlanLimitError(
            `Une bascule vers le plan ${target} est programmée. ` +
              `Impossible de créer plus de ${targetMaxEvents} événements actifs avant la bascule.`,
            {
              current: projected,
              max: targetMaxEvents,
              plan: target,
            },
          );
        }
      }
    }
  }
}

export const eventService = new EventService();
