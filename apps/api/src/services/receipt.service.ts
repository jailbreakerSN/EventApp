import { type Receipt } from "@teranga/shared-types";
import { receiptRepository } from "@/repositories/receipt.repository";
import { paymentRepository } from "@/repositories/payment.repository";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { userRepository } from "@/repositories/user.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { NotFoundError, ValidationError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

export class ReceiptService extends BaseService {
  /**
   * Generate a receipt for a succeeded payment.
   */
  async generateReceipt(paymentId: string, user: AuthUser): Promise<Receipt> {
    this.requirePermission(user, "payment:read_own");

    const payment = await paymentRepository.findByIdOrThrow(paymentId);

    // Only the payment owner or an organizer can generate a receipt
    if (payment.userId !== user.uid && !user.roles.includes("super_admin")) {
      this.requirePermission(user, "payment:read_all");
      this.requireOrganizationAccess(user, payment.organizationId);
    }

    if (payment.status !== "succeeded") {
      throw new ValidationError("Un reçu ne peut être généré que pour un paiement confirmé");
    }

    // Check if receipt already exists
    const existing = await receiptRepository.findByPayment(paymentId);
    if (existing) return existing;

    // Fetch related data for denormalization
    const [event, userDoc] = await Promise.all([
      eventRepository.findByIdOrThrow(payment.eventId),
      userRepository.findById(payment.userId),
    ]);

    let organizationName = "Teranga";
    try {
      const org = await organizationRepository.findByIdOrThrow(payment.organizationId);
      organizationName = org.name;
    } catch {
      // fallback to default
    }

    const ticketType = event.ticketTypes.find((t) => t.name);
    const now = new Date().toISOString();
    const receiptNumber = await receiptRepository.generateReceiptNumber();

    const receipt: Receipt = {
      id: "", // will be set by create
      receiptNumber,
      paymentId: payment.id,
      registrationId: payment.registrationId,
      eventId: payment.eventId,
      organizationId: payment.organizationId,
      userId: payment.userId,
      amount: payment.amount,
      currency: "XOF",
      method: payment.method,
      eventTitle: event.title,
      ticketTypeName: ticketType?.name ?? "Billet",
      participantName: userDoc?.displayName ?? "Participant",
      participantEmail: userDoc?.email ?? null,
      organizationName,
      issuedAt: now,
      createdAt: now,
    };

    const created = await receiptRepository.create(receipt);
    return created;
  }

  /**
   * Get a receipt by ID.
   */
  async getReceipt(receiptId: string, user: AuthUser): Promise<Receipt> {
    this.requirePermission(user, "payment:read_own");
    const receipt = await receiptRepository.findByIdOrThrow(receiptId);

    if (receipt.userId !== user.uid && !user.roles.includes("super_admin")) {
      this.requirePermission(user, "payment:read_all");
      this.requireOrganizationAccess(user, receipt.organizationId);
    }

    return receipt;
  }

  /**
   * List receipts for the current user.
   */
  async listMyReceipts(
    user: AuthUser,
    pagination: { page: number; limit: number },
  ) {
    this.requirePermission(user, "payment:read_own");
    return receiptRepository.findByUser(user.uid, pagination);
  }
}

export const receiptService = new ReceiptService();
