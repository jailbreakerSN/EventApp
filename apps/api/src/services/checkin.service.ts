import {
  type BulkCheckinItem,
  type BulkCheckinResponse,
  type BulkCheckinResult,
  type BulkCheckinResultStatus,
  type CheckinStats,
  type CheckinLogEntry,
  type CheckinHistoryQuery,
  type CheckinListQuery,
  type CheckinRecord,
  type AnomalyQuery,
  type AnomalyResponse,
  type AnomalyEvidence,
  type DuplicateAnomaly,
  type DeviceMismatchAnomaly,
  type VelocityOutlierAnomaly,
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
import { resolveEventKeyFromEvent } from "./qr-key-resolver";

// Maximum gap we'll accept between the client's `scannedAt` and the server's
// `now` on the bulk-sync path. A staff device can legitimately have been
// offline for days after scanning, but we cap the lag at 7 days so a
// tampered app can't replay arbitrarily old QRs under the guise of offline
// reconciliation. Tune with field data once multi-day events are in prod.
const MAX_OFFLINE_RECONCILE_LAG_MS = 7 * 24 * 60 * 60 * 1000;
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

/** Shape-shift a full `CheckinRecord` into the slim anomaly-evidence row. */
function toEvidence(row: CheckinRecord): AnomalyEvidence {
  return {
    checkinId: row.id,
    scannedAt: row.scannedAt,
    scannerDeviceId: row.scannerDeviceId,
    scannedBy: row.scannedBy,
    registrationId: row.registrationId,
    accessZoneId: row.accessZoneId,
  };
}

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

    // TTL hint for the staff device's cache purge (badge-journey-review 4.2b).
    // 24 h past event end — long enough to cover reconciliation lag for
    // late scans, short enough that a lost device doesn't carry live QRs
    // forever. Kept outside any future encrypted envelope so the client
    // can schedule the purge without decrypting the payload.
    const ttlAt = new Date(new Date(event.endDate).getTime() + 24 * 60 * 60 * 1000).toISOString();

    return {
      eventId,
      organizationId: event.organizationId,
      eventTitle: event.title,
      syncedAt: new Date().toISOString(),
      ttlAt,
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
      const result = await this.processCheckinItem(eventId, event.organizationId, item, user);
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
    organizationId: string,
    item: BulkCheckinItem,
    user: AuthUser,
  ): Promise<BulkCheckinResult> {
    // Verify QR signature — v4 payloads resolve their per-event HMAC key
    // from Firestore via the resolver; v1/v2/v3 branches ignore it.
    const parsed = await verifyQrPayload(item.qrCodeValue, resolveEventKeyFromEvent);
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

        // Apply check-in using the offline scannedAt timestamp. Device id
        // is persisted on the registration for quick "who scanned this?"
        // lookups; the full attestation (nonce, client vs server time)
        // rides on the domain event into auditLogs.
        tx.update(regRef, {
          status: "checked_in" as RegistrationStatus,
          checkedInAt: item.scannedAt,
          checkedInBy: user.uid,
          checkedInDeviceId: item.scannerDeviceId ?? null,
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
        const serverConfirmedAt = new Date().toISOString();
        eventBus.emit("checkin.completed", {
          eventId,
          organizationId,
          registrationId: registration.id,
          participantId: registration.userId,
          staffId: user.uid,
          accessZoneId: item.accessZoneId ?? null,
          // Server-confirmed timestamp (when the write landed) vs the
          // client-reported scan timestamp. Offline reconciliation can
          // open a sizeable gap between the two — forensics needs both.
          checkedInAt: item.scannedAt,
          clientScannedAt: item.scannedAt,
          scannerDeviceId: item.scannerDeviceId ?? null,
          scannerNonce: item.scannerNonce ?? null,
          source: "offline_sync",
          actorId: user.uid,
          requestId: getRequestId(),
          timestamp: serverConfirmedAt,
        });
      }

      // Shadow-write per-scan forensic row (badge-journey-review §3.3
      // commit 1). Best-effort + fire-and-forget — the legacy
      // registration flip happened inside the tx above and is the
      // authoritative check-in signal; a failure to write the forensic
      // row leaves the trail one scan short but does not affect the
      // scan outcome. Once readers migrate (follow-up commit) this will
      // move inside the tx proper.
      void this.writeShadowCheckin({
        eventId,
        organizationId,
        registration,
        item,
        parsed,
        user,
        outcomeStatus: txResult.status,
        outcomeReason: txResult.reason,
      }).catch((err: unknown) => {
        process.stderr.write(
          `[checkin-service] shadow checkins write failed for reg=${registration.id}: ${err}\n`,
        );
      });

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

  /**
   * Shadow-write a per-scan forensic row into the `checkins` collection.
   * Runs outside the main check-in transaction — shadow-write phase, the
   * registration flip in the tx remains the authoritative check-in signal.
   * Once `checkins` readers land (follow-up commit) this moves inside the
   * tx proper and becomes part of the atomic state change.
   */
  // ─── Per-scan forensic list (3.3 c3/5) ─────────────────────────────────
  // Reads from the `checkins` collection — the new per-scan forensic log.
  // Legacy `getHistory` at :502 stays on the registrations table for
  // back-compat with events that predate the shadow-write.
  async listCheckins(
    eventId: string,
    query: CheckinListQuery,
    user: AuthUser,
  ): Promise<{
    data: CheckinRecord[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    this.requirePermission(user, "checkin:view_log");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Compose the query. Composite index
    // `(eventId, status, scannedAt)` at
    // `firestore.indexes.json` handles the hot path; `accessZoneId`
    // + time-range filters fall back to
    // `(eventId, accessZoneId, scannedAt)` or the two-field
    // `(eventId, scannedAt)` index depending on which filter the
    // caller passes.
    let q = db.collection(COLLECTIONS.CHECKINS).where("eventId", "==", eventId);
    if (query.status) q = q.where("status", "==", query.status);
    if (query.accessZoneId) q = q.where("accessZoneId", "==", query.accessZoneId);
    if (query.since) q = q.where("scannedAt", ">=", query.since);
    if (query.until) q = q.where("scannedAt", "<=", query.until);

    const countSnap = await q.count().get();
    const total = countSnap.data().count;
    const offset = (query.page - 1) * query.limit;
    const pageSnap = await q.orderBy("scannedAt", "desc").offset(offset).limit(query.limit).get();
    const data = pageSnap.docs.map((d) => d.data() as CheckinRecord);

    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  // ─── Security anomalies (4.3) ──────────────────────────────────────────
  // Three signals surfaced per event:
  //   - duplicates: rows with `status === "duplicate"`.
  //   - device_mismatch: same registration seen on ≥2 scannerDeviceIds
  //     within `windowMinutes`. Canonical screenshot-share signature.
  //   - velocity_outlier: staff uid processing > velocityThreshold scans
  //     in any 60 s rolling bucket. Scripted attack or misconfigured
  //     scanner.
  //
  // Gated behind `advancedAnalytics` plan feature (pro+) so freemium
  // tiers don't carry the read cost. Two Firestore reads (duplicates +
  // success window) issued in parallel; grouping is client-side.
  async getAnomalies(
    eventId: string,
    query: AnomalyQuery,
    user: AuthUser,
  ): Promise<AnomalyResponse> {
    this.requirePermission(user, "checkin:view_log");
    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const org = await organizationRepository.findByIdOrThrow(event.organizationId);
    this.requirePlanFeature(org, "advancedAnalytics");

    const windowMs = query.windowMinutes * 60 * 1000;
    const windowStartIso = new Date(Date.now() - windowMs).toISOString();
    const MAX_ROWS = 5000;

    // Run both index scans in parallel.
    const duplicatesPromise = db
      .collection(COLLECTIONS.CHECKINS)
      .where("eventId", "==", eventId)
      .where("status", "==", "duplicate")
      .orderBy("scannedAt", "desc")
      .limit(100)
      .get();

    const windowPromise = db
      .collection(COLLECTIONS.CHECKINS)
      .where("eventId", "==", eventId)
      .where("status", "==", "success")
      .orderBy("scannedAt", "desc")
      .limit(MAX_ROWS)
      .get();

    const [dupSnap, winSnap] = await Promise.all([duplicatesPromise, windowPromise]);
    const detectedAt = new Date().toISOString();

    // ── Duplicates
    const duplicates: DuplicateAnomaly[] = dupSnap.docs.map((d) => {
      const row = d.data() as CheckinRecord;
      return {
        kind: "duplicate",
        detectedAt,
        severity: "warning",
        registrationId: row.registrationId,
        evidence: [
          {
            checkinId: row.id,
            scannedAt: row.scannedAt,
            scannerDeviceId: row.scannerDeviceId,
            scannedBy: row.scannedBy,
            registrationId: row.registrationId,
            accessZoneId: row.accessZoneId,
          },
        ],
      };
    });

    // Filter success rows to the window. We overfetch above because
    // Firestore can't `orderBy` two fields with different direction
    // without another composite, and the `limit(MAX_ROWS)` is a cheap
    // safety cap.
    const windowRows = winSnap.docs
      .map((d) => d.data() as CheckinRecord)
      .filter((r) => r.scannedAt >= windowStartIso);
    const truncated = winSnap.size === MAX_ROWS;

    // ── Device mismatch — group by registrationId, emit if ≥2 deviceIds
    const byReg = new Map<string, CheckinRecord[]>();
    for (const r of windowRows) {
      if (!r.scannerDeviceId) continue; // unattested rows don't count
      const group = byReg.get(r.registrationId);
      if (group) group.push(r);
      else byReg.set(r.registrationId, [r]);
    }
    const deviceMismatches: DeviceMismatchAnomaly[] = [];
    for (const [regId, rows] of byReg) {
      const devices = new Set(rows.map((r) => r.scannerDeviceId!));
      if (devices.size < 2) continue;
      deviceMismatches.push({
        kind: "device_mismatch",
        detectedAt,
        severity: "critical",
        registrationId: regId,
        deviceIds: [...devices],
        evidence: rows.slice(0, 10).map(toEvidence),
      });
    }

    // ── Velocity outlier — group by scannedBy into 60 s buckets
    const velocityOutliers: VelocityOutlierAnomaly[] = [];
    const byStaff = new Map<string, CheckinRecord[]>();
    for (const r of windowRows) {
      const group = byStaff.get(r.scannedBy);
      if (group) group.push(r);
      else byStaff.set(r.scannedBy, [r]);
    }
    for (const [staff, rows] of byStaff) {
      if (rows.length <= query.velocityThreshold) continue;
      // Sort ascending + sweep a 60 s window.
      const sorted = [...rows].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
      let left = 0;
      let peakBucket: CheckinRecord[] = [];
      for (let right = 0; right < sorted.length; right++) {
        while (
          left < right &&
          new Date(sorted[right].scannedAt).getTime() - new Date(sorted[left].scannedAt).getTime() >
            60_000
        ) {
          left++;
        }
        const bucket = sorted.slice(left, right + 1);
        if (bucket.length > peakBucket.length) peakBucket = bucket;
      }
      if (peakBucket.length > query.velocityThreshold) {
        velocityOutliers.push({
          kind: "velocity_outlier",
          detectedAt,
          severity: peakBucket.length > query.velocityThreshold * 2 ? "critical" : "warning",
          scannedBy: staff,
          scannerDeviceId: peakBucket[0].scannerDeviceId,
          count: peakBucket.length,
          evidence: peakBucket.slice(0, 10).map(toEvidence),
        });
      }
    }

    return {
      duplicates,
      deviceMismatches,
      velocityOutliers,
      meta: {
        windowMinutes: query.windowMinutes,
        velocityThreshold: query.velocityThreshold,
        scannedRows: windowRows.length,
        truncated,
      },
    };
  }

  private async writeShadowCheckin(ctx: {
    eventId: string;
    organizationId: string;
    registration: Registration;
    item: BulkCheckinItem;
    parsed: { version: "v1" | "v2" | "v3" | "v4"; kid?: string | null };
    user: AuthUser;
    outcomeStatus: BulkCheckinResultStatus;
    outcomeReason?: string | null;
  }): Promise<void> {
    // Map the bulk-sync outcome enum onto the persisted status tri-state.
    const status: "success" | "duplicate" | "rejected" =
      ctx.outcomeStatus === "success"
        ? "success"
        : ctx.outcomeStatus === "already_checked_in"
          ? "duplicate"
          : "rejected";
    // Reuse the same reject-code alphabet as the wire enum where it maps
    // cleanly. "already_checked_in" is surfaced as a duplicate status so
    // it needs a separate reject-code value — reuse the neighbouring
    // "invalid_status" which is the closest semantic match.
    const rejectCode: string | null =
      ctx.outcomeStatus === "success"
        ? null
        : ctx.outcomeStatus === "already_checked_in"
          ? "invalid_status"
          : ctx.outcomeStatus;

    const ref = db.collection(COLLECTIONS.CHECKINS).doc();
    const serverConfirmedAt = new Date().toISOString();
    await ref.set({
      id: ref.id,
      registrationId: ctx.registration.id,
      eventId: ctx.eventId,
      organizationId: ctx.organizationId,
      userId: ctx.registration.userId,
      scannedAt: serverConfirmedAt,
      clientScannedAt: ctx.item.scannedAt,
      scannedBy: ctx.user.uid,
      scannerDeviceId: ctx.item.scannerDeviceId ?? null,
      scannerNonce: ctx.item.scannerNonce ?? null,
      accessZoneId: ctx.item.accessZoneId ?? null,
      status,
      source: "offline_sync" as const,
      rejectCode,
      reason: ctx.outcomeReason ?? null,
      qrPayloadVersion: ctx.parsed.version,
      qrKid: ctx.parsed.kid ?? null,
      requestId: getRequestId() ?? null,
      idempotencyKey: ctx.item.localId,
      createdAt: serverConfirmedAt,
    });
  }
}

export const checkinService = new CheckinService();
