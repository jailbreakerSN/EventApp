import { type DocumentSnapshot, type DocumentData } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository, type PaginatedResult, type PaginationParams, type WhereClause } from "./base.repository";
import { type Registration, type RegistrationStatus } from "@teranga/shared-types";

export interface CursorPage<T> {
  data: T[];
  lastDoc: DocumentSnapshot<DocumentData> | null;
}

export class RegistrationRepository extends BaseRepository<Registration> {
  constructor() {
    super(COLLECTIONS.REGISTRATIONS, "Registration");
  }

  async findByEvent(
    eventId: string,
    statuses?: RegistrationStatus[],
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Registration>> {
    const filters: WhereClause[] = [
      { field: "eventId", op: "==", value: eventId },
    ];

    if (statuses && statuses.length > 0) {
      filters.push({ field: "status", op: "in", value: statuses });
    }

    return this.findMany(filters, pagination ?? { page: 1, limit: 1000 });
  }

  async findByUser(
    userId: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResult<Registration>> {
    return this.findMany(
      [{ field: "userId", op: "==", value: userId }],
      pagination ?? { page: 1, limit: 50, orderBy: "createdAt", orderDir: "desc" },
    );
  }

  async findExisting(
    eventId: string,
    userId: string,
  ): Promise<Registration | null> {
    return this.findOne([
      { field: "eventId", op: "==", value: eventId },
      { field: "userId", op: "==", value: userId },
      { field: "status", op: "in", value: ["confirmed", "pending", "waitlisted"] },
    ]);
  }

  async findByQrCode(qrCodeValue: string): Promise<Registration | null> {
    return this.findOne([
      { field: "qrCodeValue", op: "==", value: qrCodeValue },
    ]);
  }

  /**
   * Cursor-based pagination for large result sets.
   * Returns a page of registrations and the last DocumentSnapshot for the next page.
   * Use this instead of offset-based pagination for bulk operations (badges, sync, broadcast).
   */
  async findByEventCursor(
    eventId: string,
    statuses: RegistrationStatus[],
    limit: number,
    startAfterDoc?: DocumentSnapshot<DocumentData>,
  ): Promise<CursorPage<Registration>> {
    let query = this.collection
      .where("eventId", "==", eventId)
      .where("status", "in", statuses)
      .orderBy("createdAt", "asc")
      .limit(limit);

    if (startAfterDoc) {
      query = query.startAfter(startAfterDoc);
    }

    const snap = await query.get();
    const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Registration);
    const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;

    return { data, lastDoc };
  }

  /**
   * Returns the oldest waitlisted registration for an event, optionally
   * scoped to a specific `ticketTypeId`.
   *
   * Why scope by ticket type (B2): waitlists are PER-CAPACITY. When a
   * confirmed VIP cancels, the freed slot belongs to VIP capacity — not
   * to a Standard waitlister. Promoting across ticket types would
   * over-allocate one tier and starve another. The cancel-driven
   * promotion path always passes the cancelled registration's
   * `ticketTypeId` so the waitlist FIFO is honoured WITHIN that tier.
   *
   * Manual organizer promotions (admin "promote one" UI) can pass
   * `ticketTypeId: undefined` to fall back to the global FIFO — useful
   * when an organizer wants to clear the oldest waitlister regardless
   * of tier (e.g. emptying the waitlist after raising `maxAttendees`).
   */
  async findOldestWaitlisted(
    eventId: string,
    ticketTypeId?: string,
  ): Promise<Registration | null> {
    let q = this.collection
      .where("eventId", "==", eventId)
      .where("status", "==", "waitlisted") as FirebaseFirestore.Query<FirebaseFirestore.DocumentData>;
    if (ticketTypeId) {
      q = q.where("ticketTypeId", "==", ticketTypeId);
    }
    const snap = await q.orderBy("createdAt", "asc").limit(1).get();

    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as Registration;
  }

  /**
   * Returns up to `count` oldest-first waitlisted registrations for an
   * event, optionally scoped to a ticket type. Used by the bulk-promote
   * surface (B2) so the backoffice doesn't loop one-by-one through the
   * single-promotion path. The caller must still run each promotion
   * inside its own transaction — this query just selects the candidates.
   */
  async findOldestWaitlistedBatch(
    eventId: string,
    count: number,
    ticketTypeId?: string,
  ): Promise<Registration[]> {
    let q = this.collection
      .where("eventId", "==", eventId)
      .where("status", "==", "waitlisted") as FirebaseFirestore.Query<FirebaseFirestore.DocumentData>;
    if (ticketTypeId) {
      q = q.where("ticketTypeId", "==", ticketTypeId);
    }
    const snap = await q.orderBy("createdAt", "asc").limit(count).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Registration);
  }

  /**
   * Counts the number of waitlisted registrations strictly older than
   * the given `createdAt` timestamp for the same `(eventId,
   * ticketTypeId)` slice. The position the participant sees is this
   * count plus one (so a position of 1 means "next in line"). Used to
   * surface `waitlistPosition` on registration payloads (B2).
   */
  async countWaitlistedOlderThan(
    eventId: string,
    ticketTypeId: string,
    createdAt: string,
  ): Promise<number> {
    const snap = await this.collection
      .where("eventId", "==", eventId)
      .where("ticketTypeId", "==", ticketTypeId)
      .where("status", "==", "waitlisted")
      .where("createdAt", "<", createdAt)
      .count()
      .get();
    return snap.data().count;
  }

  /**
   * Total waitlisted registrations on a given `(eventId, ticketTypeId)`
   * slice — surfaced alongside `waitlistPosition` so participants see
   * "5 / 12" rather than just their own rank. Used by the GET
   * registration payload + the participant My Events list (B2).
   */
  async countWaitlistedTotal(
    eventId: string,
    ticketTypeId: string,
  ): Promise<number> {
    const snap = await this.collection
      .where("eventId", "==", eventId)
      .where("ticketTypeId", "==", ticketTypeId)
      .where("status", "==", "waitlisted")
      .count()
      .get();
    return snap.data().count;
  }

  async checkIn(
    id: string,
    staffId: string,
    accessZoneId?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.update(id, {
      status: "checked_in" as RegistrationStatus,
      checkedInAt: now,
      checkedInBy: staffId,
      accessZoneId: accessZoneId ?? null,
    } as Partial<Registration>);
  }
}

export const registrationRepository = new RegistrationRepository();
