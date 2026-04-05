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

  async findOldestWaitlisted(eventId: string): Promise<Registration | null> {
    const snap = await this.collection
      .where("eventId", "==", eventId)
      .where("status", "==", "waitlisted")
      .orderBy("createdAt", "asc")
      .limit(1)
      .get();

    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as Registration;
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
