import {
  type CreatePromoCodeDto,
  type PromoCode,
  type PromoCodeQuery,
} from "@teranga/shared-types";
import { promoCodeRepository } from "@/repositories/promo-code.repository";
import { eventRepository } from "@/repositories/event.repository";
import { type PaginatedResult } from "@/repositories/base.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import {
  ConflictError,
  ValidationError,
} from "@/errors/app-error";
import { db, COLLECTIONS } from "@/config/firebase";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

// ─── Service ─────────────────────────────────────────────────────────────────

export class PromoCodeService extends BaseService {
  /**
   * Create a new promo code for an event.
   * Requires event:update permission and org access.
   */
  async createPromoCode(dto: CreatePromoCodeDto, user: AuthUser): Promise<PromoCode> {
    this.requirePermission(user, "event:update");

    // Fetch event to verify org access
    const event = await eventRepository.findByIdOrThrow(dto.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Validate discount value
    if (dto.discountType === "percentage" && (dto.discountValue < 1 || dto.discountValue > 100)) {
      throw new ValidationError("La valeur de remise en pourcentage doit être entre 1 et 100");
    }
    if (dto.discountType === "fixed" && dto.discountValue <= 0) {
      throw new ValidationError("La valeur de remise fixe doit être positive");
    }

    // Check for duplicate code on this event
    const existing = await promoCodeRepository.findByCode(dto.eventId, dto.code);
    if (existing) {
      throw new ConflictError(`Le code promo « ${dto.code} » existe déjà pour cet événement`);
    }

    const promoCode = await promoCodeRepository.create({
      eventId: dto.eventId,
      organizationId: event.organizationId,
      code: dto.code.toUpperCase(),
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      maxUses: dto.maxUses ?? null,
      usedCount: 0,
      expiresAt: dto.expiresAt ?? null,
      ticketTypeIds: dto.ticketTypeIds ?? [],
      isActive: true,
      createdBy: user.uid,
    } as Omit<PromoCode, "id" | "createdAt" | "updatedAt">);

    eventBus.emit("promo_code.created", {
      promoCodeId: promoCode.id,
      eventId: dto.eventId,
      organizationId: event.organizationId,
      code: promoCode.code,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return promoCode;
  }

  /**
   * Validate a promo code for a given event and ticket type.
   * Public endpoint — no auth required.
   * Returns validation result with discount info.
   */
  async validatePromoCode(
    eventId: string,
    code: string,
    ticketTypeId: string,
  ): Promise<{ valid: boolean; promoCodeId: string; discountType: string; discountValue: number }> {
    const promoCode = await promoCodeRepository.findByCode(eventId, code);

    if (!promoCode) {
      throw new ValidationError("Code promo introuvable ou invalide");
    }

    if (!promoCode.isActive) {
      throw new ValidationError("Ce code promo n'est plus actif");
    }

    // Check expiration
    if (promoCode.expiresAt && new Date(promoCode.expiresAt) < new Date()) {
      throw new ValidationError("Ce code promo a expiré");
    }

    // Check max uses
    if (promoCode.maxUses !== null && promoCode.usedCount >= promoCode.maxUses) {
      throw new ValidationError("Ce code promo a atteint son nombre maximum d'utilisations");
    }

    // Check ticket type applicability
    if (promoCode.ticketTypeIds.length > 0 && !promoCode.ticketTypeIds.includes(ticketTypeId)) {
      throw new ValidationError("Ce code promo ne s'applique pas à ce type de billet");
    }

    return {
      valid: true,
      promoCodeId: promoCode.id,
      discountType: promoCode.discountType,
      discountValue: promoCode.discountValue,
    };
  }

  /**
   * Increment usedCount within a transaction.
   * Called after a successful payment/registration.
   */
  async applyPromoCode(promoCodeId: string): Promise<void> {
    await db.runTransaction(async (tx) => {
      const docRef = db.collection(COLLECTIONS.PROMO_CODES).doc(promoCodeId);
      const snap = await tx.get(docRef);

      if (!snap.exists) {
        throw new ValidationError("Code promo introuvable");
      }

      const promoCode = { id: snap.id, ...snap.data() } as PromoCode;

      // Re-check limits inside transaction
      if (promoCode.maxUses !== null && promoCode.usedCount >= promoCode.maxUses) {
        throw new ValidationError("Ce code promo a atteint son nombre maximum d'utilisations");
      }

      tx.update(docRef, {
        usedCount: promoCode.usedCount + 1,
        updatedAt: new Date().toISOString(),
      });
    });

    eventBus.emit("promo_code.used", {
      promoCodeId,
      actorId: "system",
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * List promo codes for an event (organizer only).
   */
  async listPromoCodes(
    eventId: string,
    query: PromoCodeQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<PromoCode>> {
    this.requirePermission(user, "event:read");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    return promoCodeRepository.findByEvent(eventId, {
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * Deactivate a promo code (soft disable).
   */
  async deactivatePromoCode(promoCodeId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:update");

    const promoCode = await promoCodeRepository.findByIdOrThrow(promoCodeId);

    // Fetch event to verify org access
    const event = await eventRepository.findByIdOrThrow(promoCode.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    await promoCodeRepository.update(promoCodeId, {
      isActive: false,
    } as Partial<PromoCode>);
  }
}

export const promoCodeService = new PromoCodeService();
