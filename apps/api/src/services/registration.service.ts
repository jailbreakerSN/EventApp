import {
  type Registration,
  type RegistrationStatus,
  type QrScanResult,
  type Event,
  type Organization,
  type UserProfile,
} from "@teranga/shared-types";
import { registrationRepository } from "@/repositories/registration.repository";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { userRepository } from "@/repositories/user.repository";
import { type PaginationParams, type PaginatedResult } from "@/repositories/base.repository";
import { runTransaction, FieldValue } from "@/repositories/transaction.helper";
import { db, COLLECTIONS } from "@/config/firebase";
import { type AuthUser } from "@/middlewares/auth.middleware";
import {
  ValidationError,
  DuplicateRegistrationError,
  EmailNotVerifiedError,
  EventFullError,
  RegistrationClosedError,
  QrInvalidError,
  QrAlreadyUsedError,
  QrExpiredError,
  QrNotYetValidError,
  NotFoundError,
  PlanLimitError,
  ZoneFullError,
} from "@/errors/app-error";
import { BaseService } from "./base.service";
import {
  signQrPayload,
  signQrPayloadV4,
  verifyQrPayload,
  checkScanTime,
  computeValidityWindow,
} from "./qr-signing";
import { resolveEventKeyFromEvent } from "./qr-key-resolver";
import { computeLockKey, type ScanPolicy } from "./checkin-policy";
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
  async register(eventId: string, ticketTypeId: string, user: AuthUser): Promise<Registration> {
    this.requirePermission(user, "registration:create");

    const result = await runTransaction(async (tx) => {
      // ── Read event inside transaction for consistent capacity check ──
      const eventRef = eventRepository.ref.doc(eventId);
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) {
        throw new NotFoundError("Event", eventId);
      }
      const event = { id: eventSnap.id, ...eventSnap.data() } as Event;

      // Event must be published — reason is disambiguated so the UI can
      // render a targeted blocking state (see error-handling.md).
      if (event.status !== "published") {
        const reason =
          event.status === "cancelled"
            ? "event_cancelled"
            : event.status === "completed"
              ? "event_completed"
              : event.status === "archived"
                ? "event_archived"
                : "event_not_published";
        throw new RegistrationClosedError(eventId, reason);
      }

      // Check registration deadline
      if (new Date() > new Date(event.endDate)) {
        throw new RegistrationClosedError(eventId, "event_ended");
      }

      // ── Check plan participant-per-event limit ──
      // Grace period: skip if event has already started (never block during live events)
      const eventStarted = new Date() >= new Date(event.startDate);
      if (!eventStarted) {
        const orgRef = organizationRepository.ref.doc(event.organizationId);
        const orgSnap = await tx.get(orgRef);
        if (orgSnap.exists) {
          const org = { id: orgSnap.id, ...orgSnap.data() } as Organization;
          const { allowed, limit } = this.checkPlanLimit(
            org,
            "participantsPerEvent",
            event.registeredCount,
          );
          if (!allowed) {
            throw new PlanLimitError(
              `Maximum ${limit} participants par événement sur le plan ${org.effectivePlanKey ?? org.plan}`,
              {
                current: event.registeredCount,
                max: limit,
                plan: org.effectivePlanKey ?? org.plan,
              },
            );
          }
        }
      }

      // ── Check for duplicate registration (inside tx) ──
      const duplicateQuery = registrationRepository.ref
        .where("eventId", "==", eventId)
        .where("userId", "==", user.uid)
        .where("status", "in", ["confirmed", "pending", "waitlisted"])
        .limit(1);
      const duplicateSnap = await tx.get(duplicateQuery);
      if (!duplicateSnap.empty) {
        // Typed `details.reason` lets the UI render a targeted "Vous êtes
        // déjà inscrit(e)" state with a "Voir mes inscriptions" CTA
        // instead of the generic CONFLICT copy. See error-handling.md.
        throw new DuplicateRegistrationError(eventId);
      }

      // ── Validate ticket type ──
      const ticketType = event.ticketTypes.find((t) => t.id === ticketTypeId);
      if (!ticketType) {
        throw new ValidationError(
          `Type de billet « ${ticketTypeId} » introuvable pour cet événement`,
        );
      }

      // ── Gate paid registrations behind email verification ──
      // Free tickets remain low-friction to maximise adoption; paid tickets
      // must verify email first so receipts + payment notifications land.
      if (ticketType.price > 0 && !user.emailVerified) {
        throw new EmailNotVerifiedError();
      }

      // ── Capacity / waitlist gate (B2 — ticket-type aware) ─────────────────
      // Two capacity dimensions:
      //   1. Per-ticket-type:  ticketType.soldCount >= totalQuantity
      //   2. Event-level:      event.registeredCount >= maxAttendees
      // Either one being saturated makes the registration ineligible
      // for "confirmed". The disposition then depends on requiresApproval:
      //   - requiresApproval=true  → waitlist (organizer decides per-tier)
      //   - requiresApproval=false → reject with EventFullError
      // Pre-B2 the ticket-type check was a hard reject regardless of
      // requiresApproval; that meant an organizer with `requiresApproval=true`
      // could waitlist on event-level capacity but NOT on ticket-type
      // sold-out — a real funnel hole. B2 closes it.
      const ticketSoldOut =
        ticketType.totalQuantity !== null &&
        ticketType.soldCount >= ticketType.totalQuantity;
      const eventSoldOut = !!(event.maxAttendees && event.registeredCount >= event.maxAttendees);
      const anyCapacityHit = ticketSoldOut || eventSoldOut;

      if (anyCapacityHit && !event.requiresApproval) {
        throw new EventFullError(eventId);
      }

      // ── Determine initial status ──
      // requiresApproval=true ALWAYS routes to a non-confirmed status:
      // - capacity hit → waitlisted (the organizer must promote)
      // - no capacity hit → pending (the organizer must approve)
      // Without requiresApproval, the only path to non-confirmed is
      // event-level overflow (ticket overflow already threw above).
      let status: RegistrationStatus = "confirmed";
      if (event.requiresApproval) {
        status = anyCapacityHit ? "waitlisted" : "pending";
      } else if (eventSoldOut) {
        status = "waitlisted";
      }

      // ── Create registration document ──
      const now = new Date().toISOString();
      const regRef = registrationRepository.ref.doc();
      const regId = regRef.id;
      // v3 embeds the validity window; v4 adds a per-event `kid` so a
      // rotation on one event doesn't compromise the others. Signer picks
      // v4 when the event already has a kid (new events since the
      // badge-journey-review rollout), otherwise falls back to v3 for
      // legacy events whose docs pre-date the qrKid field.
      const window = computeValidityWindow(event.startDate, event.endDate);
      const qrCodeValue = event.qrKid
        ? signQrPayloadV4(regId, eventId, user.uid, window.notBefore, window.notAfter, event.qrKid)
        : signQrPayload(regId, eventId, user.uid, window.notBefore, window.notAfter);

      // Fetch user profile for denormalized display fields. Must go through
      // tx.get() so the read participates in the transaction's snapshot —
      // a naked userRepository.findById() here would race against concurrent
      // profile updates (e.g. display-name edits) between the read set and
      // the subsequent tx.set(regRef, registration) write.
      const userSnap = await tx.get(userRepository.ref.doc(user.uid));
      const userProfile = userSnap.exists
        ? ({ id: userSnap.id, ...userSnap.data() } as unknown as UserProfile)
        : null;

      const registration: Registration = {
        id: regId,
        eventId,
        userId: user.uid,
        ticketTypeId,
        eventTitle: event.title,
        eventSlug: event.slug,
        eventStartDate: event.startDate,
        eventEndDate: event.endDate,
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
      // B2 (security review remediation) — `registration:cancel_any` alone
      // did NOT scope to the registration's org. An organizer holding the
      // permission could cancel a registration owned by a foreign org,
      // and the cancel-driven waitlist promotion would then run inside
      // that foreign org's context. The fix: read the event up-front and
      // gate on `requireOrganizationAccess(user, event.organizationId)`
      // BEFORE entering the transaction. Super-admin still bypasses via
      // the helper's admin-role short-circuit.
      this.requirePermission(user, "registration:cancel_any");
      const event = await eventRepository.findByIdOrThrow(registration.eventId);
      this.requireOrganizationAccess(user, event.organizationId);
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

      // Firestore transactions require all reads before any writes — capture
      // the event (for organizationId + counter decrement) BEFORE mutating
      // the registration. Skipping this ordering makes the emulator throw
      // "all reads must precede writes" even though a lot of mocked unit
      // tests happily pass.
      const eventRef = eventRepository.ref.doc(current.eventId);
      const eventSnap = await tx.get(eventRef);
      const organizationId = eventSnap.exists
        ? ((eventSnap.data() as Record<string, unknown>).organizationId as string)
        : "";

      const now = new Date().toISOString();
      tx.update(regRef, {
        status: "cancelled",
        updatedAt: now,
      });

      // Decrement counter for any status that was previously COUNTED at
      // register-time. `register()` increments `registeredCount`
      // unconditionally — confirmed, pending, AND waitlisted entries —
      // so cancellation must mirror the same scope, otherwise the
      // counter drifts upward (cancel-of-waitlisted leaks +1 every
      // time). The B2 senior review surfaced this as a real consistency
      // bug pre-existing the waitlist surface but exposed by it.
      if (
        current.status === "confirmed" ||
        current.status === "pending" ||
        current.status === "waitlisted"
      ) {
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
    // ON THE SAME TICKET TYPE. Cross-tier promotion would over-allocate
    // one tier and starve another (B2 — the bug we're fixing here).
    // Fire-and-forget: promotion failure must not affect the cancel response,
    // BUT a silent swallow was hiding data-drift from operators (waitlisted
    // user still in limbo, event slot still open, zero observability).
    // Structured log + dedicated domain event surfaces it in Cloud
    // Logging metrics AND the audit log without blocking the caller.
    if (registration.status === "confirmed") {
      this.promoteNextWaitlisted(
        eventPayload.eventId,
        eventPayload.organizationId,
        user.uid,
        registration.ticketTypeId,
      ).catch((err: unknown) => {
        const reqId = getRequestId();
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[RegistrationService] reqId=${reqId} waitlist promotion failed for ` +
            `event=${eventPayload.eventId} org=${eventPayload.organizationId} ` +
            `ticketType=${registration.ticketTypeId} after ` +
            `cancel of reg=${registrationId}: ${reason}\n`,
        );
        // Emit the dedicated event so the audit listener records it and
        // any ops metric on `waitlist.promotion_failed` can page.
        // `ticketTypeId` carries the tier the failed promotion was
        // scoped to — without it, an operator looking at the audit row
        // can't tell which tier's slot is stuck (B2 senior review).
        eventBus.emit("waitlist.promotion_failed", {
          eventId: eventPayload.eventId,
          organizationId: eventPayload.organizationId,
          cancelledRegistrationId: registrationId,
          ticketTypeId: registration.ticketTypeId,
          reason,
          actorId: user.uid,
          requestId: reqId,
          timestamp: new Date().toISOString(),
        });
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
  async checkIn(
    qrCodeValue: string,
    user: AuthUser,
    opts: {
      accessZoneId?: string;
      scannerDeviceId?: string;
      scannerNonce?: string;
    } = {},
  ): Promise<QrScanResult> {
    this.requirePermission(user, "checkin:scan");
    const { accessZoneId, scannerDeviceId, scannerNonce } = opts;

    // Verify QR signature. v1/v2/v3 resolve synchronously from QR_SECRET;
    // v4 needs a per-event key — we resolve by reading the event doc's
    // `qrKid` (current) or `qrKidHistory[]` (retired but still within the
    // rotation window) and deriving the HMAC key from QR_MASTER.
    const parsed = await verifyQrPayload(qrCodeValue, resolveEventKeyFromEvent);
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

    // Gate QR check-in behind `qrScanning` (starter+). Looked up via the
    // event's org since the caller is an authenticated staff/organizer, not
    // the participant, and the registration itself doesn't carry orgId.
    const event = await eventRepository.findByIdOrThrow(registration.eventId);
    const org = await organizationRepository.findByIdOrThrow(event.organizationId);
    this.requirePlanFeature(org, "qrScanning");

    // Validity window check. v3 QRs carry `notBefore`/`notAfter` in the signed
    // payload — those are authoritative. v1/v2 QRs predate the window field,
    // so we fall back to the canonical window derived from the event dates
    // (same formula the signer uses), which still shuts the "valid forever"
    // door on legacy badges.
    const nowMs = Date.now();
    const window =
      parsed.notBefore && parsed.notAfter
        ? {
            notBefore: new Date(parsed.notBefore).getTime(),
            notAfter: new Date(parsed.notAfter).getTime(),
          }
        : computeValidityWindow(event.startDate, event.endDate);
    const verdict = checkScanTime(nowMs, window.notBefore, window.notAfter);
    if (verdict === "too_early") {
      throw new QrNotYetValidError(new Date(window.notBefore).toISOString());
    }
    if (verdict === "expired") {
      throw new QrExpiredError(new Date(window.notAfter).toISOString());
    }

    // Pre-build a random id + createdAt for the shadow `checkins` doc.
    // The same fields participate in the tx for every outcome (success
    // → status "success", "already" → "duplicate", anything else is
    // already handled above / cannot reach here).
    const checkinRef = db.collection(COLLECTIONS.CHECKINS).doc();
    const checkinBase = {
      id: checkinRef.id,
      eventId: registration.eventId,
      registrationId: registration.id,
      organizationId: event.organizationId,
      userId: registration.userId,
      scannedBy: user.uid,
      scannerDeviceId: scannerDeviceId ?? null,
      scannerNonce: scannerNonce ?? null,
      accessZoneId: accessZoneId ?? null,
      source: "live" as const,
      clientScannedAt: null,
      qrPayloadVersion: parsed.version,
      qrKid: parsed.kid ?? null,
      requestId: getRequestId() ?? null,
      idempotencyKey: null,
      createdAt: new Date().toISOString(),
    };

    // Transaction returns a tagged envelope — the "already checked in"
    // branch needs enrichment (staff display name) that can't happen inside
    // the tx, so we surface the raw identifiers and resolve them below.
    type TxOutcome =
      | {
          kind: "success";
          checkedInAt: string;
          eventId: string;
          ticketTypeName: string | null;
          accessZoneName: string | null;
        }
      | {
          kind: "already";
          checkedInAt: string | null;
          checkedInBy: string | null;
          checkedInDeviceId: string | null;
        };

    const txResult = await runTransaction<TxOutcome>(async (tx) => {
      // All reads FIRST so the tx body is Firestore-legal (reads-then-
      // writes). Parallel get on registration + event is safe inside a
      // transaction — both land in one server round-trip.
      const regRef = registrationRepository.ref.doc(registration.id);
      const eventRef = eventRepository.ref.doc(registration.eventId);
      const [regSnap, eventSnap] = await Promise.all([tx.get(regRef), tx.get(eventRef)]);

      if (!regSnap.exists) {
        throw new QrInvalidError("Inscription introuvable");
      }
      const current = { id: regSnap.id, ...regSnap.data() } as Registration;
      const eventDoc = eventSnap.exists
        ? ({ id: eventSnap.id, ...eventSnap.data() } as Event)
        : null;

      // Short-circuit on non-confirmed statuses that the scan path cannot
      // heal (cancelled, pending, etc.). `checked_in` is NOT an early exit
      // any more — under `multi_day` / `multi_zone` a second scan is
      // legitimate as long as the per-policy lock is free.
      if (current.status !== "confirmed" && current.status !== "checked_in") {
        throw new QrInvalidError(`Registration status is '${current.status}'`);
      }

      const now = new Date().toISOString();
      const scanPolicy = (eventDoc?.scanPolicy ?? "single") as ScanPolicy;
      const lockKey = computeLockKey({
        registrationId: registration.id,
        policy: scanPolicy,
        accessZoneId,
        scannedAtIso: now,
        timezone: eventDoc?.timezone ?? "Africa/Dakar",
      });
      const lockRef = db.collection(COLLECTIONS.CHECKIN_LOCKS).doc(lockKey);
      const lockSnap = await tx.get(lockRef);

      if (lockSnap.exists) {
        // Duplicate under the active policy. Leave a forensic row; the
        // registration's first-successful-scan cache is untouched.
        tx.set(checkinRef, {
          ...checkinBase,
          scannedAt: now,
          status: "duplicate",
          rejectCode: "invalid_status",
          reason: `Déjà enregistré le ${current.checkedInAt ?? "—"} (policy ${scanPolicy})`,
        });
        return {
          kind: "already",
          checkedInAt: current.checkedInAt ?? null,
          checkedInBy: current.checkedInBy ?? null,
          checkedInDeviceId: current.checkedInDeviceId ?? null,
        };
      }

      // Zone enforcement — applies to every successful scan, including
      // secondary scans under multi_zone / multi_day. Refuse the scan if
      // the target zone is at capacity; same 409 staff sees on the bulk
      // path (`checkin.service.ts:327-340`).
      if (accessZoneId && eventDoc) {
        const zone = eventDoc.accessZones.find((z) => z.id === accessZoneId);
        if (zone?.capacity) {
          const zoneCount =
            (eventDoc as unknown as { zoneCheckedInCounts?: Record<string, number> })
              .zoneCheckedInCounts?.[accessZoneId] ?? 0;
          if (zoneCount >= zone.capacity) {
            throw new ZoneFullError({
              id: zone.id,
              name: zone.name,
              capacity: zone.capacity,
            });
          }
        }
      }

      // Success — create the lock (atomic uniqueness guard) and the
      // forensic row; flip registration status only on the first-ever
      // successful scan so the analytics counter stays true to "unique
      // participants admitted".
      tx.create(lockRef, { createdAt: now, policy: scanPolicy });

      const isFirstSuccess = current.status !== "checked_in";
      if (isFirstSuccess) {
        tx.update(regRef, {
          status: "checked_in",
          checkedInAt: now,
          checkedInBy: user.uid,
          checkedInDeviceId: scannerDeviceId ?? null,
          accessZoneId: accessZoneId ?? null,
          updatedAt: now,
        });
      } else {
        // Secondary success under multi-entry — don't clobber the first-
        // scan cache fields, just bump `updatedAt` so change-feed
        // listeners pick up the activity.
        tx.update(regRef, { updatedAt: now });
      }

      // Event counters.
      //   `checkedInCount` is the unique-participant count — bump only
      //     on the first successful scan so `multi_day` / `multi_zone`
      //     don't inflate the "how many humans came through" metric.
      //   `zoneCheckedInCounts[zoneId]` is the per-zone throughput
      //     count — bump on every successful scan into a zone so staff
      //     can see "lunch already fed 312 people" even though only
      //     200 came through the gate.
      const eventUpdate: Record<string, unknown> = { updatedAt: now };
      if (isFirstSuccess) {
        eventUpdate.checkedInCount = FieldValue.increment(1);
      }
      if (accessZoneId) {
        eventUpdate[`zoneCheckedInCounts.${accessZoneId}`] = FieldValue.increment(1);
      }
      tx.update(eventRef, eventUpdate);

      // Shadow-write the per-scan forensic row alongside the legacy
      // registration flip. Readers migrate in a follow-up commit; for
      // now the `registrations` collection remains the source of truth.
      tx.set(checkinRef, {
        ...checkinBase,
        scannedAt: now,
        status: "success",
        rejectCode: null,
        reason: null,
      });

      return {
        kind: "success",
        checkedInAt: now,
        eventId: current.eventId,
        ticketTypeName:
          eventDoc?.ticketTypes.find((t) => t.id === current.ticketTypeId)?.name ?? null,
        accessZoneName: eventDoc?.accessZones.find((z) => z.id === accessZoneId)?.name ?? null,
      };
    });

    if (txResult.kind === "already") {
      // Resolve the scanner's display name outside the tx — gate staff see
      // "Déjà validé par Aminata il y a 12 s" instead of a bare uid.
      let checkedInByName: string | null = null;
      if (txResult.checkedInBy) {
        const staff = await userRepository.findById(txResult.checkedInBy);
        checkedInByName = staff?.displayName ?? null;
      }
      throw new QrAlreadyUsedError({
        checkedInAt: txResult.checkedInAt,
        checkedInBy: txResult.checkedInBy,
        checkedInByName,
        checkedInDeviceId: txResult.checkedInDeviceId,
      });
    }

    // Emit domain event AFTER transaction commits
    eventBus.emit("checkin.completed", {
      registrationId: registration.id,
      eventId: txResult.eventId,
      organizationId: event.organizationId,
      participantId: registration.userId,
      staffId: user.uid,
      accessZoneId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: txResult.checkedInAt,
      source: "live",
      scannerDeviceId: scannerDeviceId ?? null,
      scannerNonce: scannerNonce ?? null,
      clientScannedAt: null, // live scan — client time == server time within one hop
      checkedInAt: txResult.checkedInAt,
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
   * Uses a transaction to prevent two concurrent promotions picking the
   * same entry.
   *
   * @param ticketTypeId Optional. When set, only waitlisted entries on
   * the same ticket type are eligible — matches the cancel-driven path
   * where a freed VIP slot must promote a VIP waitlister, not a Standard
   * one. When omitted, falls back to global FIFO across all tiers
   * (manual organizer promotions when no specific tier opened up).
   */
  async promoteNextWaitlisted(
    eventId: string,
    organizationId: string,
    actorId: string,
    ticketTypeId?: string,
  ): Promise<void> {
    const waitlisted = await registrationRepository.findOldestWaitlisted(
      eventId,
      ticketTypeId,
    );
    if (!waitlisted) return; // No one on the waitlist (within scope)

    const now = new Date().toISOString();
    // The tx returns whether it actually wrote — a race-loss (the
    // candidate was promoted by a concurrent path between our pre-tx
    // read and the tx-time re-check) returns `false` so we don't fire a
    // false `waitlist.promoted` event. Mirrors the same pattern in
    // `bulkPromoteWaitlisted`.
    const promoted = await runTransaction(async (tx) => {
      // Re-read inside transaction to prevent double promotion
      const regRef = registrationRepository.ref.doc(waitlisted.id);
      const regSnap = await tx.get(regRef);
      if (!regSnap.exists) return false;

      const current = { id: regSnap.id, ...regSnap.data() } as Registration;
      if (current.status !== "waitlisted") return false; // Already promoted by another request

      tx.update(regRef, {
        status: "confirmed",
        promotedFromWaitlistAt: now,
        updatedAt: now,
      });
      return true;
    });

    if (!promoted) return;

    eventBus.emit("waitlist.promoted", {
      registrationId: waitlisted.id,
      eventId,
      userId: waitlisted.userId,
      organizationId,
      actorId,
      requestId: getRequestId(),
      timestamp: now,
    });
  }

  /**
   * Bulk-promote up to `count` waitlisted registrations on an event.
   * Replaces the backoffice's "loop one-at-a-time" pattern with a
   * single round-trip: one query for the candidate list + one
   * transaction per promotion (Firestore transactions are
   * single-document optimistic-locked — bundling them into one tx
   * would serialise on each registration anyway, and a partial-failure
   * resilient batch is the right semantic here).
   *
   * Permission: requires `event:update` on the event's organization.
   * The caller is the organizer's actor uid; promoted entries are
   * audited via the same `waitlist.promoted` event as single
   * promotions.
   *
   * @param ticketTypeId Optional. When set, scopes to a tier; matches
   * the FIFO semantics of `promoteNextWaitlisted`.
   * @returns the number of entries actually promoted (≤ count). Lower
   * if the waitlist had fewer than `count` entries or some races
   * caused the transactional re-check to skip an entry.
   */
  async bulkPromoteWaitlisted(
    eventId: string,
    organizationId: string,
    user: AuthUser,
    count: number,
    ticketTypeId?: string,
  ): Promise<{ promotedCount: number; skipped: number }> {
    this.requirePermission(user, "registration:approve");
    this.requireOrganizationAccess(user, organizationId);

    // Per-request cap (B2 senior review remediation). Each promotion
    // fires one `waitlist.promoted` event → one email + one in-app
    // notif + one FCM push. A 100-cap was operationally fine for
    // Firestore but caused a 100-message burst hitting the email
    // provider in a single request cycle. 25 is a reasonable middle
    // ground that still serves the typical "promote next 10/all"
    // organizer flow; larger purges should go through the admin job
    // runner with proper inter-message throttling.
    if (!Number.isInteger(count) || count < 1 || count > 25) {
      throw new ValidationError(
        "Le nombre de promotions doit être un entier entre 1 et 25.",
      );
    }

    const candidates = await registrationRepository.findOldestWaitlistedBatch(
      eventId,
      count,
      ticketTypeId,
    );

    let promotedCount = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      // Each promotion is its own transaction so a single mid-flight
      // race-loss doesn't roll back the whole batch.
      try {
        const promoted = await runTransaction(async (tx) => {
          const regRef = registrationRepository.ref.doc(candidate.id);
          const regSnap = await tx.get(regRef);
          if (!regSnap.exists) return false;
          const current = { id: regSnap.id, ...regSnap.data() } as Registration;
          if (current.status !== "waitlisted") return false;
          const now = new Date().toISOString();
          tx.update(regRef, {
            status: "confirmed",
            promotedFromWaitlistAt: now,
            updatedAt: now,
          });
          return true;
        });

        if (promoted) {
          promotedCount += 1;
          eventBus.emit("waitlist.promoted", {
            registrationId: candidate.id,
            eventId,
            userId: candidate.userId,
            organizationId,
            actorId: user.uid,
            requestId: getRequestId(),
            timestamp: new Date().toISOString(),
          });
        } else {
          skipped += 1;
        }
      } catch (err) {
        // Per-entry isolation: log + count, don't bubble. Emit the
        // dedicated `waitlist.promotion_failed` event so the audit log
        // captures which candidate stalled and why — silence-as-signal
        // (B2 v1) was insufficient for ops because there's no cheap
        // way to ask "which entries failed during this batch" without
        // diffing the request body against the emitted promoted events.
        skipped += 1;
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[RegistrationService] bulkPromote skipping ${candidate.id} ` +
            `(ticketType=${candidate.ticketTypeId}): ${reason}\n`,
        );
        eventBus.emit("waitlist.promotion_failed", {
          eventId,
          organizationId,
          cancelledRegistrationId: candidate.id,
          ticketTypeId: candidate.ticketTypeId,
          reason,
          actorId: user.uid,
          requestId: getRequestId(),
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { promotedCount, skipped };
  }

  /**
   * Compute a participant's position on the waitlist for their
   * (eventId, ticketTypeId) slice. Returns null when the registration
   * isn't actually waitlisted (avoids surfacing a stale "position" on
   * a confirmed/cancelled doc). Surfaced on the GET registration
   * payload + the participant My Events list — informational only,
   * never an enforcement signal.
   */
  async getWaitlistPosition(
    registrationId: string,
    user: AuthUser,
  ): Promise<{ position: number; total: number } | null> {
    const reg = await registrationRepository.findByIdOrThrow(registrationId);
    // Owner OR organizer of the event's org may read.
    if (reg.userId !== user.uid) {
      const event = await eventRepository.findByIdOrThrow(reg.eventId);
      this.requireOrganizationAccess(user, event.organizationId);
      this.requirePermission(user, "registration:read_all");
    }
    if (reg.status !== "waitlisted") return null;

    const [olderCount, total] = await Promise.all([
      registrationRepository.countWaitlistedOlderThan(
        reg.eventId,
        reg.ticketTypeId,
        reg.createdAt,
      ),
      registrationRepository.countWaitlistedTotal(reg.eventId, reg.ticketTypeId),
    ]);

    return { position: olderCount + 1, total };
  }
}

export const registrationService = new RegistrationService();
