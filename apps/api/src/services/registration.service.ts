import {
  type Registration,
  type RegistrationStatus,
  type QrScanResult,
  type Event,
} from "@teranga/shared-types";
import { registrationRepository } from "@/repositories/registration.repository";
import { eventRepository } from "@/repositories/event.repository";
import { userRepository } from "@/repositories/user.repository";
import { type PaginationParams, type PaginatedResult } from "@/repositories/base.repository";
import { runTransaction, FieldValue } from "@/repositories/transaction.helper";
import { type AuthUser } from "@/middlewares/auth.middleware";
import {
  ValidationError,
  ConflictError,
  EventFullError,
  RegistrationClosedError,
  QrInvalidError,
  QrAlreadyUsedError,
  NotFoundError,
} from "@/errors/app-error";
import { BaseService } from "./base.service";
import { signQrPayload, verifyQrPayload } from "./qr-signing";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

// ─── Service ─────────────────────────────────────────────────────────────────

export class RegistrationService extends BaseService {
  /**
   * Register a user for an event — fully transactional.
   *
   * Reads event + duplicate check inside the transaction so capacity and
   * uniqueness are guaranteed even under concurrent requests.
   * Domain event is emitted AFTER the transaction commits.
   */
  async register(
    eventId: string,
    ticketTypeId: string,
    user: AuthUser,
  ): Promise<Registration> {
    this.requirePermission(user, "registration:create");

    const result = await runTransaction(async (tx) => {
      // ── Read event inside transaction for consistent capacity check ──
      const eventRef = eventRepository.ref.doc(eventId);
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) {
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: eventSnap.id, ...eventSnap.data() } as Event;

      // Event must be published
      if (event.status !== "published") {
        throw new RegistrationClosedError(eventId);
      }

      // Check registration deadline
      if (new Date() > new Date(event.endDate)) {
        throw new RegistrationClosedError(eventId);
      }

      // ── Check for duplicate registration (inside tx) ──
      const duplicateQuery = registrationRepository.ref
        .where("eventId", "==", eventId)
        .where("userId", "==", user.uid)
        .where("status", "in", ["confirmed", "pending", "waitlisted"])
        .limit(1);
      const duplicateSnap = await tx.get(duplicateQuery);
      if (!duplicateSnap.empty) {
        throw new ConflictError("Vous êtes déjà inscrit(e) à cet événement");
      }

      // ── Validate ticket type ──
      const ticketType = event.ticketTypes.find((t) => t.id === ticketTypeId);
      if (!ticketType) {
        throw new ValidationError(`Type de billet « ${ticketTypeId} » introuvable pour cet événement`);
      }

      // Check ticket availability
      if (ticketType.totalQuantity !== null && ticketType.soldCount >= ticketType.totalQuantity) {
        throw new EventFullError(eventId);
      }

      // ── Check capacity ──
      if (event.maxAttendees && event.registeredCount >= event.maxAttendees) {
        if (!event.requiresApproval) {
          throw new EventFullError(eventId);
        }
      }

      // ── Determine initial status ──
      let status: RegistrationStatus = "confirmed";
      if (event.requiresApproval) {
        status = "pending";
      } else if (event.maxAttendees && event.registeredCount >= event.maxAttendees) {
        status = "waitlisted";
      }

      // ── Create registration document ──
      const now = new Date().toISOString();
      const regRef = registrationRepository.ref.doc();
      const regId = regRef.id;
      const qrCodeValue = signQrPayload(regId, eventId, user.uid);

      // Fetch user profile for denormalized display fields
      const userProfile = await userRepository.findById(user.uid);

      const registration: Registration = {
        id: regId,
        eventId,
        userId: user.uid,
        ticketTypeId,
        eventTitle: event.title,
        ticketTypeName: ticketType.name,
        participantName: userProfile?.displayName ?? null,
        participantEmail: userProfile?.email ?? null,
        status,
        qrCodeValue,
        checkedInAt: null,
        checkedInBy: null,
        accessZoneId: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
      } as Registration;

      tx.set(regRef, registration);

      // ── Increment event counter ──
      tx.update(eventRef, {
        registeredCount: FieldValue.increment(1),
        updatedAt: now,
      });

      return { registration, organizationId: event.organizationId };
    });

    // Emit domain event AFTER transaction commits
    eventBus.emit("registration.created", {
      registration: result.registration,
      eventId,
      organizationId: result.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return result.registration;
  }

  async getMyRegistrations(
    user: AuthUser,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Registration>> {
    this.requirePermission(user, "registration:read_own");
    return registrationRepository.findByUser(user.uid, pagination);
  }

  async getEventRegistrations(
    eventId: string,
    user: AuthUser,
    statuses?: RegistrationStatus[],
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Registration>> {
    this.requirePermission(user, "registration:read_all");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const result = await registrationRepository.findByEvent(eventId, statuses, pagination);

    // Enrich registrations that lack denormalized participant info (backward compat)
    const needsEnrichment = result.data.filter((r) => !r.participantName);
    if (needsEnrichment.length > 0) {
      const userIds = [...new Set(needsEnrichment.map((r) => r.userId))];
      const profiles = await Promise.all(
        userIds.map((uid) => userRepository.findById(uid).then((p) => [uid, p] as const)),
      );
      const profileMap = new Map(profiles);
      for (const reg of result.data) {
        if (!reg.participantName) {
          const profile = profileMap.get(reg.userId);
          if (profile) {
            reg.participantName = profile.displayName ?? null;
            reg.participantEmail = profile.email ?? null;
          }
        }
      }
    }

    return result;
  }

  /**
   * Cancel a registration — transactional status update + counter decrement.
   * Domain event emitted after commit.
   */
  async cancel(registrationId: string, user: AuthUser): Promise<void> {
    // Read registration outside tx for permission check (non-transactional read is fine here;
    // the transaction re-reads for the actual mutation to ensure consistency)
    const registration = await registrationRepository.findByIdOrThrow(registrationId);

    if (registration.userId === user.uid) {
      this.requirePermission(user, "registration:cancel_own");
    } else {
      this.requirePermission(user, "registration:cancel_any");
    }

    const eventPayload = await runTransaction(async (tx) => {
      // Re-read registration inside transaction for consistency
      const regRef = registrationRepository.ref.doc(registrationId);
      const regSnap = await tx.get(regRef);
      if (!regSnap.exists) {
        throw new NotFoundError("Registration", registrationId);
      }
      const current = { id: regSnap.id, ...regSnap.data() } as Registration;

      if (current.status === "cancelled") {
        throw new ValidationError("L'inscription est déjà annulée");
      }
      if (current.status === "checked_in") {
        throw new ValidationError("Impossible d'annuler une inscription déjà vérifiée");
      }

      const now = new Date().toISOString();
      tx.update(regRef, {
        status: "cancelled",
        updatedAt: now,
      });

      // Read event inside tx to capture organizationId for audit trail
      const eventRef = eventRepository.ref.doc(current.eventId);
      const eventSnap = await tx.get(eventRef);
      const organizationId = eventSnap.exists
        ? (eventSnap.data() as Record<string, unknown>).organizationId as string
        : "";

      // Decrement counter only for statuses that were counted
      if (current.status === "confirmed" || current.status === "pending") {
        tx.update(eventRef, {
          registeredCount: FieldValue.increment(-1),
          updatedAt: now,
        });
      }

      return {
        eventId: current.eventId,
        userId: current.userId,
        organizationId,
      };
    });

    eventBus.emit("registration.cancelled", {
      registrationId,
      eventId: eventPayload.eventId,
      userId: eventPayload.userId,
      organizationId: eventPayload.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    // If a confirmed registration was cancelled, promote next waitlisted
    // Fire-and-forget: promotion failure should not affect the cancel response
    if (registration.status === "confirmed") {
      this.promoteNextWaitlisted(eventPayload.eventId, eventPayload.organizationId, user.uid).catch(() => {
        // Swallowed — audit listener will log the cancellation regardless
      });
    }
  }

  /**
   * Approve a pending/waitlisted registration — fully transactional.
   *
   * Re-reads registration + event inside the transaction to prevent race
   * conditions (e.g., concurrent cancel overwriting approved status).
   * Domain event emitted after commit.
   */
  async approve(registrationId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "registration:approve");

    const eventPayload = await runTransaction(async (tx) => {
      const regRef = registrationRepository.ref.doc(registrationId);
      const regSnap = await tx.get(regRef);
      if (!regSnap.exists) {
        throw new NotFoundError("Registration", registrationId);
      }
      const current = { id: regSnap.id, ...regSnap.data() } as Registration;

      if (current.status !== "pending" && current.status !== "waitlisted") {
        throw new ValidationError(`Cannot approve registration with status '${current.status}'`);
      }

      // Read event for org access check and audit trail
      const eventRef = eventRepository.ref.doc(current.eventId);
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) {
        throw new NotFoundError("Event", current.eventId);
      }
      const event = { id: eventSnap.id, ...eventSnap.data() } as Event;
      this.requireOrganizationAccess(user, event.organizationId);

      const now = new Date().toISOString();
      tx.update(regRef, {
        status: "confirmed",
        updatedAt: now,
      });

      return {
        eventId: current.eventId,
        userId: current.userId,
        organizationId: event.organizationId,
      };
    });

    eventBus.emit("registration.approved", {
      registrationId,
      eventId: eventPayload.eventId,
      userId: eventPayload.userId,
      organizationId: eventPayload.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Check in a participant via QR scan — transactional.
   *
   * QR signature is verified before the transaction. Inside the transaction
   * we re-read the registration to ensure no double check-in under concurrency.
   */
  async checkIn(qrCodeValue: string, user: AuthUser, accessZoneId?: string): Promise<QrScanResult> {
    this.requirePermission(user, "checkin:scan");

    // Verify QR signature (stateless, no DB needed)
    const parsed = verifyQrPayload(qrCodeValue);
    if (!parsed) {
      throw new QrInvalidError("Signature invalide");
    }

    // Look up registration by QR to get the document ID (outside tx — query not supported in tx on non-ref)
    const registration = await registrationRepository.findByQrCode(qrCodeValue);
    if (!registration) {
      throw new QrInvalidError("Inscription introuvable");
    }

    // Pre-fetch participant info (read-only, no consistency concern)
    const participant = await userRepository.findById(registration.userId);

    const txResult = await runTransaction(async (tx) => {
      // Re-read registration inside transaction for double-check-in safety
      const regRef = registrationRepository.ref.doc(registration.id);
      const regSnap = await tx.get(regRef);
      if (!regSnap.exists) {
        throw new QrInvalidError("Inscription introuvable");
      }
      const current = { id: regSnap.id, ...regSnap.data() } as Registration;

      if (current.status === "checked_in") {
        throw new QrAlreadyUsedError(current.checkedInAt ?? undefined);
      }
      if (current.status !== "confirmed") {
        throw new QrInvalidError(`Registration status is '${current.status}'`);
      }

      const now = new Date().toISOString();

      // Update registration to checked_in
      tx.update(regRef, {
        status: "checked_in",
        checkedInAt: now,
        checkedInBy: user.uid,
        accessZoneId: accessZoneId ?? null,
        updatedAt: now,
      });

      // Increment event check-in counter
      const eventRef = eventRepository.ref.doc(current.eventId);
      tx.update(eventRef, {
        checkedInCount: FieldValue.increment(1),
        updatedAt: now,
      });

      // Read event inside tx for ticket/zone resolution
      const eventSnap = await tx.get(eventRef);
      const event = eventSnap.exists
        ? ({ id: eventSnap.id, ...eventSnap.data() } as Event)
        : null;

      return {
        checkedInAt: now,
        eventId: current.eventId,
        ticketTypeName: event?.ticketTypes.find((t) => t.id === current.ticketTypeId)?.name ?? null,
        accessZoneName: event?.accessZones.find((z) => z.id === accessZoneId)?.name ?? null,
      };
    });

    // Emit domain event AFTER transaction commits
    eventBus.emit("checkin.completed", {
      registrationId: registration.id,
      eventId: txResult.eventId,
      participantId: registration.userId,
      staffId: user.uid,
      accessZoneId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: txResult.checkedInAt,
    });

    return {
      valid: true,
      registrationId: registration.id,
      participantName: participant?.displayName ?? null,
      ticketType: txResult.ticketTypeName,
      accessZone: txResult.accessZoneName,
      alreadyCheckedIn: false,
      checkedInAt: txResult.checkedInAt,
      reason: null,
    };
  }

  /**
   * Promote the oldest waitlisted registration to confirmed for an event.
   * Uses a transaction to prevent two concurrent promotions picking the same entry.
   */
  async promoteNextWaitlisted(
    eventId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const waitlisted = await registrationRepository.findOldestWaitlisted(eventId);
    if (!waitlisted) return; // No one on the waitlist

    await runTransaction(async (tx) => {
      // Re-read inside transaction to prevent double promotion
      const regRef = registrationRepository.ref.doc(waitlisted.id);
      const regSnap = await tx.get(regRef);
      if (!regSnap.exists) return;

      const current = { id: regSnap.id, ...regSnap.data() } as Registration;
      if (current.status !== "waitlisted") return; // Already promoted by another request

      const now = new Date().toISOString();
      tx.update(regRef, {
        status: "confirmed",
        updatedAt: now,
      });
    });

    eventBus.emit("waitlist.promoted", {
      registrationId: waitlisted.id,
      eventId,
      userId: waitlisted.userId,
      organizationId,
      actorId,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

}

export const registrationService = new RegistrationService();
