import {
  type BulkCheckinItem,
  type BulkCheckinResponse,
  type BulkCheckinResult,
  type BulkCheckinResultStatus,
  type CheckinStats,
  type CheckinLogEntry,
  type CheckinHistoryQuery,
  type OfflineSyncData,
  type Registration,
  type RegistrationStatus,
} from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { registrationRepository } from "@/repositories/registration.repository";
import { userRepository } from "@/repositories/user.repository";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";
import {
  verifyQrPayload,
  checkScanTime,
  computeValidityWindow,
  SCAN_CLOCK_SKEW_MS,
} from "./qr-signing";

// Maximum gap we'll accept between the client's `scannedAt` and the server's
// `now` on the bulk-sync path. A staff device can legitimately have been
// offline for days after scanning, but we cap the lag at 7 days so a
// tampered app can't replay arbitrarily old QRs under the guise of offline
// reconciliation. Tune with field data once multi-day events are in prod.
const MAX_OFFLINE_RECONCILE_LAG_MS = 7 * 24 * 60 * 60 * 1000;
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

    // Gate offline QR sync behind `qrScanning` (starter+). This is the
    // platform's core differentiator — paid feature by design.
    const org = await organizationRepository.findByIdOrThrow(event.organizationId);
    this.requirePlanFeature(org, "qrScanning");

    // Fetch all scannable registrations via cursor pagination
    const CHUNK_SIZE = 1000;
    const MAX_REGISTRATIONS = 20_000;
    const allRegistrations: Registration[] = [];
    let lastDoc: DocumentSnapshot | null = null;

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

    // Gate batch QR-scan sync behind `qrScanning` (starter+).
    const org = await organizationRepository.findByIdOrThrow(event.organizationId);
    this.requirePlanFeature(org, "qrScanning");

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
        reason: "Signature QR invalide",
      };
    }

    // Sanity-bound the client-reported scan time before using it as "now" for
    // the validity window. Offline staff devices can legitimately reconcile
    // days after a scan, but a tampered app could backdate `scannedAt` into
    // a past validity window to replay an expired QR. A 7-day lag ceiling
    // and a skew-bounded future guard accept legitimate offline work while
    // rejecting obvious forgeries.
    const scannedAtMs = new Date(item.scannedAt).getTime();
    if (!Number.isFinite(scannedAtMs)) {
      return {
        localId: item.localId,
        status: "invalid_qr",
        registrationId: null,
        reason: "Horodatage de scan invalide",
      };
    }
    const nowMs = Date.now();
    if (scannedAtMs > nowMs + SCAN_CLOCK_SKEW_MS) {
      return {
        localId: item.localId,
        status: "invalid_qr",
        registrationId: null,
        reason: "Horodatage de scan dans le futur — appareil probablement compromis",
      };
    }
    if (nowMs - scannedAtMs > MAX_OFFLINE_RECONCILE_LAG_MS) {
      return {
        localId: item.localId,
        status: "invalid_qr",
        registrationId: null,
        reason: "Scan hors-ligne trop ancien pour être réconcilié",
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
        const eventRefForWindow = db.collection(COLLECTIONS.EVENTS).doc(eventId);
        const [snap, eventSnapForWindow] = await Promise.all([
          tx.get(regRef),
          tx.get(eventRefForWindow),
        ]);
        if (!snap.exists) {
          return { status: "not_found" as BulkCheckinResultStatus, reason: "Registration deleted" };
        }

        // Validity window enforcement. For v3 QRs the window is authoritative
        // inside the signed payload; for legacy v1/v2 QRs we fall back to a
        // window derived from the event dates — same formula the signer uses.
        // If the event is missing dates (should never happen, but defensive)
        // we fail CLOSED rather than let the scan through unchecked.
        const eventData = eventSnapForWindow.data();
        let window: { notBefore: number; notAfter: number } | null = null;
        if (parsed.notBefore && parsed.notAfter) {
          window = {
            notBefore: new Date(parsed.notBefore).getTime(),
            notAfter: new Date(parsed.notAfter).getTime(),
          };
        } else if (eventData?.startDate && eventData?.endDate) {
          window = computeValidityWindow(eventData.startDate, eventData.endDate);
        } else {
          return {
            status: "invalid_status" as BulkCheckinResultStatus,
            reason: "Fenêtre de validité introuvable pour cet événement",
          };
        }
        const verdict = checkScanTime(scannedAtMs, window.notBefore, window.notAfter);
        if (verdict === "too_early") {
          return {
            status: "not_yet_valid" as BulkCheckinResultStatus,
            reason: `Badge non encore valide (ouverture le ${new Date(window.notBefore).toISOString()})`,
          };
        }
        if (verdict === "expired") {
          return {
            status: "expired" as BulkCheckinResultStatus,
            reason: `Badge expiré (clôture le ${new Date(window.notAfter).toISOString()})`,
          };
        }

        const current = { id: snap.id, ...snap.data() } as Registration;

        // Cancelled registration: cancel always wins
        if (current.status === "cancelled") {
          return {
            status: "cancelled" as BulkCheckinResultStatus,
            reason: "Registration was cancelled",
          };
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

        // Zone capacity check — reuses the event snap already read for the
        // validity window (a second tx.get after a tx.set is illegal in
        // Firestore transactions, so we must consolidate reads).
        const { FieldValue } = await import("firebase-admin/firestore");
        const eventRef = eventRefForWindow;

        if (item.accessZoneId) {
          const zone = eventData?.accessZones?.find(
            (z: { id: string; capacity?: number | null }) => z.id === item.accessZoneId,
          );
          if (zone?.capacity) {
            const zoneCount = eventData?.zoneCheckedInCounts?.[item.accessZoneId] ?? 0;
            if (zoneCount >= zone.capacity) {
              return {
                status: "zone_full" as BulkCheckinResultStatus,
                reason: `Zone "${zone.name}" is at capacity (${zone.capacity})`,
              };
            }
          }
        }

        // Apply check-in using the offline scannedAt timestamp
        tx.update(regRef, {
          status: "checked_in" as RegistrationStatus,
          checkedInAt: item.scannedAt,
          checkedInBy: user.uid,
          accessZoneId: item.accessZoneId ?? null,
          updatedAt: new Date().toISOString(),
        });

        // Increment event checkedInCount + zone counter
        const updateData: Record<string, unknown> = {
          checkedInCount: FieldValue.increment(1),
        };
        if (item.accessZoneId) {
          updateData[`zoneCheckedInCounts.${item.accessZoneId}`] = FieldValue.increment(1);
        }
        tx.update(eventRef, updateData);

        return { status: "success" as BulkCheckinResultStatus, checkedInAt: item.scannedAt };
      });

      const participant = await userRepository.findById(registration.userId);

      if (txResult.status === "success") {
        eventBus.emit("checkin.completed", {
          eventId,
          registrationId: registration.id,
          participantId: registration.userId,
          staffId: user.uid,
          accessZoneId: item.accessZoneId ?? null,
          checkedInAt: item.scannedAt,
          source: "offline_sync",
          actorId: user.uid,
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
    const cancelled = await registrationRepository.findByEvent(eventId, ["cancelled"], {
      page: 1,
      limit: 1,
    });

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
  /**
   * Get paginated check-in history for an event (checked-in registrations with participant info).
   */
  async getHistory(
    eventId: string,
    query: CheckinHistoryQuery,
    user: AuthUser,
  ): Promise<{
    data: CheckinLogEntry[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    this.requirePermission(user, "checkin:view_log");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Build Firestore query for checked-in registrations
    let baseQuery = db
      .collection(COLLECTIONS.REGISTRATIONS)
      .where("eventId", "==", eventId)
      .where("status", "==", "checked_in");

    if (query.accessZoneId) {
      baseQuery = baseQuery.where("accessZoneId", "==", query.accessZoneId);
    }

    // Get total count
    const countSnap = await baseQuery.count().get();
    const total = countSnap.data().count;

    // Paginate
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const offset = (page - 1) * limit;

    const snap = await baseQuery.orderBy("checkedInAt", "desc").offset(offset).limit(limit).get();

    const registrations = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Registration);

    // Batch-fetch participant + staff info
    const userIds = [
      ...new Set([
        ...registrations.map((r) => r.userId),
        ...registrations.filter((r) => r.checkedInBy).map((r) => r.checkedInBy!),
      ]),
    ];
    const users = await userRepository.batchGet(userIds);
    const userMap = new Map(users.map((u) => [u.uid ?? u.id, u]));

    // Build zone name map
    const zoneMap = new Map(event.accessZones.map((z) => [z.id, z.name]));

    // Build ticket type name map
    const ttMap = new Map(event.ticketTypes.map((t) => [t.id, t.name]));

    // Filter by search query (post-query — Firestore doesn't support text search)
    let entries: CheckinLogEntry[] = registrations.map((reg) => {
      const participant = userMap.get(reg.userId);
      const staff = reg.checkedInBy ? userMap.get(reg.checkedInBy) : null;
      return {
        registrationId: reg.id,
        participantName: participant?.displayName ?? null,
        participantEmail: participant?.email ?? null,
        ticketTypeName: ttMap.get(reg.ticketTypeId) ?? "Unknown",
        accessZoneName: reg.accessZoneId ? (zoneMap.get(reg.accessZoneId) ?? null) : null,
        checkedInAt: reg.checkedInAt ?? reg.updatedAt ?? new Date().toISOString(),
        checkedInBy: reg.checkedInBy ?? "unknown",
        staffName: staff?.displayName ?? null,
        source: "live" as const,
      };
    });

    if (query.q) {
      const q = query.q.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.participantName?.toLowerCase().includes(q) ||
          e.participantEmail?.toLowerCase().includes(q),
      );
    }

    return {
      data: entries,
      meta: {
        page,
        limit,
        total: query.q ? entries.length : total, // if filtered client-side, use filtered count
        totalPages: Math.ceil((query.q ? entries.length : total) / limit),
      },
    };
  }
}

export const checkinService = new CheckinService();
