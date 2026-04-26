/**
 * Organizer overhaul — Phase O8.
 *
 * Floor-ops incident registry. Every signalement (medical, theft,
 * latecomer, technical, logistics, security, other) creates one
 * row with severity + status + free-text description. Organizer
 * triages via assignment + status updates; staff log via the
 * mobile / live-page form.
 *
 * Permission model:
 *   - `create()` requires `checkin:scan` — staff in the field can
 *     log without organizer rights.
 *   - `update()` / `resolve()` require `event:update` — only
 *     organizers move the workflow forward.
 *   - `list()` requires `checkin:view_log` — both organizers and
 *     staff need to see the open log on the live page.
 *
 * Audit: every create / update / resolve emits a domain event so
 * the listener writes a row. Resolution time is computed at the
 * service layer (createdAt → resolvedAt) and travels in the event
 * payload for SLA dashboards.
 */

import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import { NotFoundError } from "@/errors/app-error";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type { CreateIncidentDto, Incident, UpdateIncidentDto } from "@teranga/shared-types";

function eventEnvelope(actorId: string) {
  const ctx = getRequestContext();
  return {
    actorId,
    requestId: ctx?.requestId ?? "unknown",
    timestamp: new Date().toISOString(),
  };
}

class IncidentService extends BaseService {
  async create(eventId: string, dto: CreateIncidentDto, user: AuthUser): Promise<Incident> {
    this.requirePermission(user, "checkin:scan");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const now = new Date().toISOString();
    const ref = db.collection(COLLECTIONS.INCIDENTS).doc();
    const incident: Incident = {
      id: ref.id,
      eventId,
      organizationId: event.organizationId,
      kind: dto.kind,
      severity: dto.severity,
      status: "open",
      description: dto.description,
      location: dto.location ?? null,
      reportedBy: user.uid,
      assignedTo: null,
      resolutionNote: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    await ref.set(incident);

    eventBus.emit("incident.created", {
      ...eventEnvelope(user.uid),
      incidentId: ref.id,
      eventId,
      organizationId: event.organizationId,
      kind: dto.kind,
      severity: dto.severity,
    });

    return incident;
  }

  async list(
    eventId: string,
    user: AuthUser,
    filters: { status?: Incident["status"] } = {},
  ): Promise<Incident[]> {
    this.requirePermission(user, "checkin:view_log");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    let query = db.collection(COLLECTIONS.INCIDENTS).where("eventId", "==", eventId);
    if (filters.status) {
      query = query.where("status", "==", filters.status);
    }
    // Most recent first — the floor-ops UI surfaces the freshest at
    // the top of the list. Cap at 200 to keep payload bounded.
    query = query.orderBy("createdAt", "desc").limit(200);
    const snap = await query.get();
    return snap.docs.map((d) => d.data() as Incident);
  }

  async update(incidentId: string, dto: UpdateIncidentDto, user: AuthUser): Promise<Incident> {
    this.requirePermission(user, "event:update");

    const ref = db.collection(COLLECTIONS.INCIDENTS).doc(incidentId);

    // Read-then-write must run in a transaction. Two organizers
    // triaging the same incident at once would otherwise race on the
    // status transition — the duplicate `incident.resolved` emit
    // alone is reason enough to atomically gate the transition (the
    // SLA log row would be double-counted).
    const { existing, next, isResolving } = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError("Incident introuvable");
      const existingDoc = snap.data() as Incident;
      this.requireOrganizationAccess(user, existingDoc.organizationId);

      const now = new Date().toISOString();
      const transitioning = dto.status === "resolved" && existingDoc.status !== "resolved";
      const nextDoc: Incident = {
        ...existingDoc,
        status: dto.status ?? existingDoc.status,
        assignedTo: dto.assignedTo !== undefined ? dto.assignedTo : existingDoc.assignedTo,
        resolutionNote:
          dto.resolutionNote !== undefined ? dto.resolutionNote : existingDoc.resolutionNote,
        updatedAt: now,
        resolvedAt: transitioning ? now : (existingDoc.resolvedAt ?? null),
      };
      tx.set(ref, nextDoc);
      return { existing: existingDoc, next: nextDoc, isResolving: transitioning };
    });

    const changes: Record<string, unknown> = {};
    if (dto.status !== undefined && dto.status !== existing.status) changes.status = dto.status;
    if (dto.assignedTo !== undefined && dto.assignedTo !== existing.assignedTo) {
      changes.assignedTo = dto.assignedTo;
    }
    if (dto.resolutionNote !== undefined && dto.resolutionNote !== existing.resolutionNote) {
      // We log only `notesChanged: true`, not the value — privacy
      // mirror of the participant profile pattern.
      changes.resolutionNoteChanged = true;
    }

    eventBus.emit("incident.updated", {
      ...eventEnvelope(user.uid),
      incidentId,
      eventId: existing.eventId,
      organizationId: existing.organizationId,
      changes,
    });

    if (isResolving) {
      const created = new Date(existing.createdAt).getTime();
      const resolved = new Date(next.resolvedAt ?? next.updatedAt).getTime();
      eventBus.emit("incident.resolved", {
        ...eventEnvelope(user.uid),
        incidentId,
        eventId: existing.eventId,
        organizationId: existing.organizationId,
        durationMs: Math.max(0, resolved - created),
      });
    }

    return next;
  }
}

export const incidentService = new IncidentService();
