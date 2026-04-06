import {
  type BulkCheckinItem,
  type BulkCheckinResponse,
  type BulkCheckinResult,
  type BulkCheckinResultStatus,
  type CheckinStats,
  type OfflineSyncData,
  type Registration,
  type RegistrationStatus,
} from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { registrationRepository } from "@/repositories/registration.repository";
import { userRepository } from "@/repositories/user.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";
import { verifyQrPayload } from "./qr-signing";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

export class CheckinService extends BaseService {
  /**
   * Build offline sync payload for staff QR scanning.
   * Fetches all confirmed/checked_in registrations with participant info.
   */
  async getOfflineSyncData(eventId: string, user: AuthUser): Promise<OfflineSyncData> {
    this.requirePermission(user, "checkin:sync_offline");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Fetch all scannable registrations via cursor pagination
    const CHUNK_SIZE = 1000;
    const MAX_REGISTRATIONS = 20_000;
    const allRegistrations: Registration[] = [];
    let lastDoc: import("firebase-admin/firestore").DocumentSnapshot | null = null;

    let hasMore = true;
    while (hasMore && allRegistrations.length < MAX_REGISTRATIONS) {
      const page = await registrationRepository.findByEventCursor(
        eventId,
        ["confirmed", "waitlisted", "checked_in"],
        CHUNK_SIZE,
        lastDoc ?? undefined,
      );
      allRegistrations.push(...page.data);
      lastDoc = page.lastDoc;
      hasMore = page.data.length === CHUNK_SIZE;
    }

    // Batch-fetch participant info
    const userIds = [...new Set(allRegistrations.map((r) => r.userId))];
    const users = await userRepository.batchGet(userIds);
    const userMap = new Map(users.map((u) => [u.uid ?? u.id, u]));

    return {
      eventId,
      organizationId: event.organizationId,
      eventTitle: event.title,
      syncedAt: new Date().toISOString(),
      totalRegistrations: allRegistrations.length,
      registrations: allRegistrations.map((reg) => {
        const participant = userMap.get(reg.userId);
        const ticketType = event.ticketTypes.find((t) => t.id === reg.ticketTypeId);
        return {
          id: reg.id,
          qrCodeValue: reg.qrCodeValue,
          userId: reg.userId,
          participantName: participant?.displayName ?? null,
          participantEmail: participant?.email ?? null,
          ticketTypeId: reg.ticketTypeId,
          ticketTypeName: ticketType?.name ?? "Unknown",
          status: reg.status,
          accessZoneIds: ticketType?.accessZoneIds ?? [],
          checkedIn: reg.status === "checked_in",
          checkedInAt: reg.checkedInAt ?? null,
        };
      }),
      accessZones: event.accessZones.map((z) => ({
        id: z.id,
        name: z.name,
        color: z.color,
        capacity: z.capacity ?? null,
      })),
      ticketTypes: event.ticketTypes.map((t) => ({
        id: t.id,
        name: t.name,
      })),
    };
  }

  /**
   * Process a batch of offline check-ins with conflict resolution.
   * Cancellation takes priority. Timestamp-based last-write-wins for valid check-ins.
   */
  async bulkSync(
    eventId: string,
    items: BulkCheckinItem[],
    user: AuthUser,
  ): Promise<BulkCheckinResponse> {
    this.requirePermission(user, "checkin:scan");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const results: BulkCheckinResult[] = [];
    let succeeded = 0;
    let failed = 0;

    // Process each item individually for granular conflict resolution
    for (const item of items) {
      const result = await this.processCheckinItem(eventId, item, user);
      results.push(result);
      if (result.status === "success") {
        succeeded++;
      } else {
        failed++;
      }
    }

    eventBus.emit("checkin.bulk_synced", {
      eventId,
      organizationId: event.organizationId,
      processed: items.length,
      succeeded,
      failed,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return {
      eventId,
      processed: items.length,
      succeeded,
      failed,
      results,
    };
  }

  private async processCheckinItem(
    eventId: string,
    item: BulkCheckinItem,
    user: AuthUser,
  ): Promise<BulkCheckinResult> {
    // Verify QR signature
    const parsed = verifyQrPayload(item.qrCodeValue);
    if (!parsed) {
      return {
        localId: item.localId,
        status: "invalid_qr",
        registrationId: null,
        reason: "Invalid QR signature",
      };
    }

    // Find registration by QR code
    const registration = await registrationRepository.findByQrCode(item.qrCodeValue);
    if (!registration) {
      return {
        localId: item.localId,
        status: "not_found",
        registrationId: null,
        reason: "Registration not found for this QR code",
      };
    }

    // Verify this registration belongs to the expected event
    if (registration.eventId !== eventId) {
      return {
        localId: item.localId,
        status: "not_found",
        registrationId: registration.id,
        reason: "Registration does not belong to this event",
      };
    }

    // Process check-in in a transaction
    try {
      const txResult = await db.runTransaction(async (tx) => {
        const regRef = db.collection(COLLECTIONS.REGISTRATIONS).doc(registration.id);
        const snap = await tx.get(regRef);
        if (!snap.exists) {
          return { status: "not_found" as BulkCheckinResultStatus, reason: "Registration deleted" };
        }

        const current = { id: snap.id, ...snap.data() } as Registration;

        // Cancelled registration: cancel always wins
        if (current.status === "cancelled") {
          return { status: "cancelled" as BulkCheckinResultStatus, reason: "Registration was cancelled" };
        }

        // Already checked in
        if (current.status === "checked_in") {
          return {
            status: "already_checked_in" as BulkCheckinResultStatus,
            reason: `Already checked in at ${current.checkedInAt ?? "unknown time"}`,
            checkedInAt: current.checkedInAt ?? null,
          };
        }

        // Only confirmed registrations can be checked in
        if (current.status !== "confirmed") {
          return {
            status: "invalid_status" as BulkCheckinResultStatus,
            reason: `Registration status is '${current.status}'`,
          };
        }

        // Apply check-in using the offline scannedAt timestamp
        tx.update(regRef, {
          status: "checked_in" as RegistrationStatus,
          checkedInAt: item.scannedAt,
          checkedInBy: user.uid,
          accessZoneId: item.accessZoneId ?? null,
          updatedAt: new Date().toISOString(),
        });

        // Increment event checkedInCount
        const eventRef = db.collection(COLLECTIONS.EVENTS).doc(eventId);
        const { FieldValue } = await import("firebase-admin/firestore");
        tx.update(eventRef, {
          checkedInCount: FieldValue.increment(1),
        });

        return { status: "success" as BulkCheckinResultStatus, checkedInAt: item.scannedAt };
      });

      const participant = await userRepository.findById(registration.userId);

      if (txResult.status === "success") {
        eventBus.emit("checkin.completed", {
          eventId,
          registrationId: registration.id,
          userId: registration.userId,
          staffId: user.uid,
          accessZoneId: item.accessZoneId ?? null,
          checkedInAt: item.scannedAt,
          source: "offline_sync",
          requestId: getRequestId(),
          timestamp: new Date().toISOString(),
        });
      }

      return {
        localId: item.localId,
        status: txResult.status,
        registrationId: registration.id,
        participantName: participant?.displayName ?? null,
        checkedInAt: txResult.checkedInAt ?? null,
        reason: txResult.reason ?? null,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        localId: item.localId,
        status: "not_found",
        registrationId: registration.id,
        reason: `Transaction failed: ${message}`,
      };
    }
  }

  /**
   * Aggregate check-in statistics for an event.
   */
  async getStats(eventId: string, user: AuthUser): Promise<CheckinStats> {
    this.requirePermission(user, "checkin:view_log");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Fetch all registrations (non-cancelled)
    const { data: registrations } = await registrationRepository.findByEvent(
      eventId,
      ["confirmed", "pending", "waitlisted", "checked_in"],
      { page: 1, limit: 10000 },
    );

    const checkedIn = registrations.filter((r) => r.status === "checked_in");
    const pending = registrations.filter((r) => r.status === "pending");
    const cancelled = await registrationRepository.findByEvent(eventId, ["cancelled"], { page: 1, limit: 1 });

    // Zone stats
    const zoneMap = new Map<string, number>();
    for (const reg of checkedIn) {
      if (reg.accessZoneId) {
        zoneMap.set(reg.accessZoneId, (zoneMap.get(reg.accessZoneId) ?? 0) + 1);
      }
    }

    // Ticket type stats
    const ticketMap = new Map<string, { registered: number; checkedIn: number }>();
    for (const reg of registrations) {
      const existing = ticketMap.get(reg.ticketTypeId) ?? { registered: 0, checkedIn: 0 };
      existing.registered++;
      if (reg.status === "checked_in") existing.checkedIn++;
      ticketMap.set(reg.ticketTypeId, existing);
    }

    // Find last check-in time
    const lastCheckin = checkedIn
      .filter((r) => r.checkedInAt)
      .sort((a, b) => (b.checkedInAt ?? "").localeCompare(a.checkedInAt ?? ""))[0];

    return {
      eventId,
      totalRegistered: registrations.length,
      totalCheckedIn: checkedIn.length,
      totalPending: pending.length,
      totalCancelled: cancelled.meta.total,
      byZone: event.accessZones.map((zone) => ({
        zoneId: zone.id,
        zoneName: zone.name,
        checkedIn: zoneMap.get(zone.id) ?? 0,
        capacity: zone.capacity ?? null,
      })),
      byTicketType: event.ticketTypes.map((tt) => ({
        ticketTypeId: tt.id,
        ticketTypeName: tt.name,
        registered: ticketMap.get(tt.id)?.registered ?? 0,
        checkedIn: ticketMap.get(tt.id)?.checkedIn ?? 0,
      })),
      lastCheckinAt: lastCheckin?.checkedInAt ?? null,
    };
  }
}

export const checkinService = new CheckinService();
