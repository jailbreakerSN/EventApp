import { COLLECTIONS } from "@/config/firebase";
import { BaseRepository, type PaginatedResult, type PaginationParams } from "./base.repository";
import { type PromoCode } from "@teranga/shared-types";

export class PromoCodeRepository extends BaseRepository<PromoCode> {
  constructor() {
    super(COLLECTIONS.PROMO_CODES, "PromoCode");
  }

  /**
   * Find an active promo code by its code string within a specific event.
   */
  async findByCode(eventId: string, code: string): Promise<PromoCode | null> {
    return this.findOne([
      { field: "eventId", op: "==", value: eventId },
      { field: "code", op: "==", value: code.toUpperCase() },
    ]);
  }

  /**
   * List promo codes for an event with pagination.
   */
  async findByEvent(
    eventId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<PromoCode>> {
    return this.findMany(
      [{ field: "eventId", op: "==", value: eventId }],
      { ...pagination, orderBy: "createdAt", orderDir: "desc" },
    );
  }
}

export const promoCodeRepository = new PromoCodeRepository();
