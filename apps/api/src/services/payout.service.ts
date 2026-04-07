import { type Payout, type PaymentSummary } from "@teranga/shared-types";
import { payoutRepository } from "@/repositories/payout.repository";
import { paymentRepository } from "@/repositories/payment.repository";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ValidationError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

// Platform fee configuration — 5% default
const PLATFORM_FEE_RATE = Number(process.env.PLATFORM_FEE_RATE ?? "0.05");

export class PayoutService extends BaseService {
  /**
   * Preview payout calculation for an event and period.
   */
  async calculatePayout(
    eventId: string,
    periodFrom: string,
    periodTo: string,
    user: AuthUser,
  ): Promise<{ totalAmount: number; platformFee: number; netAmount: number; paymentCount: number }> {
    this.requirePermission(user, "payout:read");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const { data: payments } = await paymentRepository.findByEvent(eventId, { status: "succeeded" }, { page: 1, limit: 10000 });

    // Filter by period
    const filtered = payments.filter((p) => {
      const completedAt = p.completedAt ?? p.createdAt;
      return completedAt >= periodFrom && completedAt <= periodTo;
    });

    const totalAmount = filtered.reduce((sum, p) => sum + p.amount - p.refundedAmount, 0);
    const platformFee = Math.round(totalAmount * PLATFORM_FEE_RATE);
    const netAmount = totalAmount - platformFee;

    return {
      totalAmount,
      platformFee,
      netAmount,
      paymentCount: filtered.length,
    };
  }

  /**
   * Create a payout record for an event and period.
   */
  async createPayout(
    eventId: string,
    periodFrom: string,
    periodTo: string,
    user: AuthUser,
  ): Promise<Payout> {
    this.requirePermission(user, "payout:create");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const { data: payments } = await paymentRepository.findByEvent(eventId, { status: "succeeded" }, { page: 1, limit: 10000 });

    const filtered = payments.filter((p) => {
      const completedAt = p.completedAt ?? p.createdAt;
      return completedAt >= periodFrom && completedAt <= periodTo;
    });

    if (filtered.length === 0) {
      throw new ValidationError("Aucun paiement confirmé dans la période sélectionnée");
    }

    const totalAmount = filtered.reduce((sum, p) => sum + p.amount - p.refundedAmount, 0);
    const platformFee = Math.round(totalAmount * PLATFORM_FEE_RATE);
    const netAmount = totalAmount - platformFee;
    const now = new Date().toISOString();

    const payout: Payout = {
      id: "",
      organizationId: event.organizationId,
      eventId,
      totalAmount,
      platformFee,
      platformFeeRate: PLATFORM_FEE_RATE,
      netAmount,
      status: "pending",
      paymentIds: filtered.map((p) => p.id),
      periodFrom,
      periodTo,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const created = await payoutRepository.create(payout);
    return created;
  }

  /**
   * List payouts for an organization.
   */
  async listPayouts(
    organizationId: string,
    filters: { status?: string },
    pagination: { page: number; limit: number },
    user: AuthUser,
  ) {
    this.requirePermission(user, "payout:read");
    this.requireOrganizationAccess(user, organizationId);
    return payoutRepository.findByOrganization(organizationId, filters, pagination);
  }

  /**
   * Get a payout detail.
   */
  async getPayoutDetail(payoutId: string, user: AuthUser): Promise<Payout> {
    this.requirePermission(user, "payout:read");
    const payout = await payoutRepository.findByIdOrThrow(payoutId);
    this.requireOrganizationAccess(user, payout.organizationId);
    return payout;
  }
}

export const payoutService = new PayoutService();
