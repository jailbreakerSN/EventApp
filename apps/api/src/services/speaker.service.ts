import {
  type SpeakerProfile,
  type CreateSpeakerDto,
  type UpdateSpeakerDto,
} from "@teranga/shared-types";
import { speakerRepository } from "@/repositories/speaker.repository";
import { eventRepository } from "@/repositories/event.repository";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { ConflictError, ForbiddenError } from "@/errors/app-error";
import { BaseService } from "./base.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";

export class SpeakerService extends BaseService {
  /**
   * Add a speaker to an event.
   */
  async createSpeaker(dto: CreateSpeakerDto, user: AuthUser): Promise<SpeakerProfile> {
    this.requirePermission(user, "event:manage_speakers");

    const event = await eventRepository.findByIdOrThrow(dto.eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    // Check for duplicate speaker (same userId + event)
    if (dto.userId) {
      const existing = await speakerRepository.findByUser(dto.userId, dto.eventId);
      if (existing) {
        throw new ConflictError("Cet utilisateur est déjà intervenant pour cet événement");
      }
    }

    const now = new Date().toISOString();
    const speaker: SpeakerProfile = {
      id: "",
      userId: dto.userId ?? null,
      eventId: dto.eventId,
      organizationId: event.organizationId,
      name: dto.name,
      title: dto.title ?? null,
      company: dto.company ?? null,
      bio: dto.bio ?? null,
      photoURL: dto.photoURL ?? null,
      socialLinks: dto.socialLinks ?? null,
      topics: dto.topics ?? [],
      sessionIds: dto.sessionIds ?? [],
      isConfirmed: false,
      createdAt: now,
      updatedAt: now,
    };

    const created = await speakerRepository.create(speaker);

    eventBus.emit("speaker.added", {
      speakerId: created.id,
      eventId: dto.eventId,
      organizationId: event.organizationId,
      name: dto.name,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    return created;
  }

  /**
   * Update a speaker profile.
   * Organizers can update any speaker; speakers can update their own.
   */
  async updateSpeaker(speakerId: string, dto: UpdateSpeakerDto, user: AuthUser): Promise<SpeakerProfile> {
    const speaker = await speakerRepository.findByIdOrThrow(speakerId);

    // Speaker updating own profile
    if (speaker.userId === user.uid) {
      this.requirePermission(user, "speaker:update_own");
    } else {
      this.requirePermission(user, "event:manage_speakers");
      this.requireOrganizationAccess(user, speaker.organizationId);
    }

    await speakerRepository.update(speakerId, {
      ...dto,
      updatedAt: new Date().toISOString(),
    } as Partial<SpeakerProfile>);

    return speakerRepository.findByIdOrThrow(speakerId);
  }

  /**
   * Remove a speaker from an event.
   */
  async deleteSpeaker(speakerId: string, user: AuthUser): Promise<void> {
    this.requirePermission(user, "event:manage_speakers");
    const speaker = await speakerRepository.findByIdOrThrow(speakerId);
    this.requireOrganizationAccess(user, speaker.organizationId);
    await speakerRepository.update(speakerId, {
      isConfirmed: false,
      sessionIds: [],
      updatedAt: new Date().toISOString(),
    } as Partial<SpeakerProfile>);

    eventBus.emit("speaker.removed", {
      speakerId,
      eventId: speaker.eventId,
      organizationId: speaker.organizationId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * List speakers for an event (public).
   */
  async listEventSpeakers(
    eventId: string,
    pagination: { page: number; limit: number },
  ) {
    return speakerRepository.findByEvent(eventId, pagination);
  }

  /**
   * Get speaker detail.
   */
  async getSpeaker(speakerId: string): Promise<SpeakerProfile> {
    return speakerRepository.findByIdOrThrow(speakerId);
  }

  /**
   * Get speaker profile for the current user at an event.
   */
  async getMySpeakerProfile(eventId: string, user: AuthUser): Promise<SpeakerProfile | null> {
    return speakerRepository.findByUser(user.uid, eventId);
  }
}

export const speakerService = new SpeakerService();
