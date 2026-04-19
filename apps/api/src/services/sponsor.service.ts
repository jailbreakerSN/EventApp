import {
  type SponsorProfile,
  type CreateSponsorDto,
  type UpdateSponsorDto,
  type SponsorLead,
  type CreateLeadDto,
} from "@teranga/shared-types";
import { sponsorRepository } from "@/repositories/sponsor.repository";
import { sponsorLeadRepository } from "@/repositories/sponsor-lead.repository";
import { eventRepository } from "@/repositories/event.repository";
import { organizationRepository } from "@/repositories/organization.repository";
import { userRepository } from "@/repositories/user.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ConflictError, ValidationError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { verifyQrPayload } from "./qr-signing";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

export class SponsorService extends BaseService {
  /**
   * Add a sponsor to an event.
   */
  async createSponsor(dto: CreateSponsorDto, user: AuthUser): Promise<SponsorProfile> {
    this.requirePermission(user, "event:manage_sponsors");

    const event = await eventRepository.findByIdOrThrow(dto.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Gate sponsor portal features behind `sponsorPortal` (pro+).
    const org = await organizationRepository.findByIdOrThrow(event.organizationId);
    this.requirePlanFeature(org, "sponsorPortal");

    const now = new Date().toISOString();
    const sponsor: SponsorProfile = {
      id: "",
      userId: dto.userId ?? null,
      eventId: dto.eventId,
      organizationId: event.organizationId,
      companyName: dto.companyName,
      logoURL: dto.logoURL ?? null,
      description: dto.description ?? null,
      website: dto.website ?? null,
      tier: dto.tier,
      boothTitle: null,
      boothDescription: null,
      boothBannerURL: null,
      ctaLabel: null,
      ctaUrl: null,
      contactName: dto.contactName ?? null,
      contactEmail: dto.contactEmail ?? null,
      contactPhone: dto.contactPhone ?? null,
      isActive: true,
      createdBy: user.uid,
      createdAt: now,
      updatedAt: now,
    };

    const created = await sponsorRepository.create(sponsor);

    eventBus.emit("sponsor.added", {
      sponsorId: created.id,
      eventId: dto.eventId,
      organizationId: event.organizationId,
      companyName: dto.companyName,
      tier: dto.tier,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return created;
  }

  /**
   * Update a sponsor profile.
   * Organizers can update any; sponsors can update their own booth.
   */
  async updateSponsor(
    sponsorId: string,
    dto: UpdateSponsorDto,
    user: AuthUser,
  ): Promise<SponsorProfile> {
    const sponsor = await sponsorRepository.findByIdOrThrow(sponsorId);

    if (sponsor.userId === user.uid) {
      this.requirePermission(user, "sponsor:manage_booth");
    } else {
      this.requirePermission(user, "event:manage_sponsors");
      this.requireOrganizationAccess(user, sponsor.organizationId);
    }

    // Gate behind `sponsorPortal` regardless of which branch — if the org
    // downgraded below pro, the portal surface is gone and booth mutations
    // (self or organizer) must be blocked consistently with create/delete.
    const org = await organizationRepository.findByIdOrThrow(sponsor.organizationId);
    this.requirePlanFeature(org, "sponsorPortal");

    await sponsorRepository.update(sponsorId, {
      ...dto,
      updatedAt: new Date().toISOString(),
    } as Partial<SponsorProfile>);

    return sponsorRepository.findByIdOrThrow(sponsorId);
  }

  /**
   * Remove a sponsor from an event.
   */
  async deleteSponsor(sponsorId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:manage_sponsors");
    const sponsor = await sponsorRepository.findByIdOrThrow(sponsorId);
    this.requireOrganizationAccess(user, sponsor.organizationId);

    const org = await organizationRepository.findByIdOrThrow(sponsor.organizationId);
    this.requirePlanFeature(org, "sponsorPortal");

    await sponsorRepository.update(sponsorId, {
      isActive: false,
      updatedAt: new Date().toISOString(),
    } as Partial<SponsorProfile>);

    eventBus.emit("sponsor.removed", {
      sponsorId,
      eventId: sponsor.eventId,
      organizationId: sponsor.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * List sponsors for an event.
   */
  async listEventSponsors(
    eventId: string,
    filters: { tier?: string },
    pagination: { page: number; limit: number },
  ) {
    return sponsorRepository.findByEvent(eventId, filters, pagination);
  }

  /**
   * Get sponsor detail.
   */
  async getSponsor(sponsorId: string): Promise<SponsorProfile> {
    return sponsorRepository.findByIdOrThrow(sponsorId);
  }

  // ─── Lead Scanning ──────────────────────────────────────────────────────

  /**
   * Scan a participant's QR badge to collect a lead.
   */
  async scanLead(sponsorId: string, dto: CreateLeadDto, user: AuthUser): Promise<SponsorLead> {
    this.requirePermission(user, "sponsor:collect_leads");

    const sponsor = await sponsorRepository.findByIdOrThrow(sponsorId);

    if (!sponsor.isActive) {
      throw new ValidationError("Ce sponsor n'est pas actif");
    }

    // IDOR fix: verify org access via sponsor's event
    const event = await eventRepository.findByIdOrThrow(sponsor.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Parse QR code to get registrationId and verify signature
    const qrParts = dto.qrCodeValue.split(":");
    if (qrParts.length < 4) {
      throw new ValidationError("QR code invalide");
    }

    const [, eventId, userId] = qrParts;

    // Verify QR signature
    if (!verifyQrPayload(dto.qrCodeValue)) {
      throw new ValidationError("Signature QR invalide");
    }

    // Verify the registration belongs to this sponsor's event
    if (eventId !== sponsor.eventId) {
      throw new ValidationError("Ce badge n'appartient pas à cet événement");
    }

    // Check for duplicate lead
    const existing = await sponsorLeadRepository.findByParticipant(sponsorId, userId);
    if (existing) {
      throw new ConflictError("Ce participant a déjà été scanné");
    }

    // Get participant info
    const participant = await userRepository.findById(userId);

    const now = new Date().toISOString();
    const lead: SponsorLead = {
      id: "",
      sponsorId,
      eventId: sponsor.eventId,
      participantId: userId,
      participantName: participant?.displayName ?? "Participant",
      participantEmail: participant?.email ?? null,
      participantPhone: participant?.phone ?? null,
      notes: dto.notes ?? null,
      tags: dto.tags ?? [],
      scannedAt: now,
      scannedBy: user.uid,
    };

    const created = await sponsorLeadRepository.create(lead);

    eventBus.emit("sponsor.lead_captured", {
      leadId: created.id,
      sponsorId,
      eventId: sponsor.eventId,
      participantId: userId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return created;
  }

  /**
   * List leads for a sponsor.
   */
  async listLeads(sponsorId: string, pagination: { page: number; limit: number }, user: AuthUser) {
    this.requirePermission(user, "sponsor:view_leads");
    const sponsor = await sponsorRepository.findByIdOrThrow(sponsorId);

    // Verify access: either the sponsor user or an organizer
    if (sponsor.userId !== user.uid) {
      this.requireOrganizationAccess(user, sponsor.organizationId);
    }

    return sponsorLeadRepository.findBySponsor(sponsorId, pagination);
  }

  /**
   * Export leads as JSON array (client converts to CSV).
   */
  async exportLeads(sponsorId: string, user: AuthUser): Promise<SponsorLead[]> {
    this.requirePermission(user, "sponsor:view_leads");
    const sponsor = await sponsorRepository.findByIdOrThrow(sponsorId);

    if (sponsor.userId !== user.uid) {
      this.requireOrganizationAccess(user, sponsor.organizationId);
    }

    // Gate bulk lead export behind `csvExport` (starter+). The sponsor can
    // still view the leads list via listLeads() — only the bulk export is
    // restricted.
    const org = await organizationRepository.findByIdOrThrow(sponsor.organizationId);
    this.requirePlanFeature(org, "csvExport");

    const result = await sponsorLeadRepository.findBySponsor(sponsorId, { page: 1, limit: 10000 });
    return result.data;
  }
}

export const sponsorService = new SponsorService();
