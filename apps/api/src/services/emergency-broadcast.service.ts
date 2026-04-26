/**
 * Organizer overhaul — Phase O8.
 *
 * Emergency multi-channel fan-out. Distinct from regular broadcasts
 * (Phase O5):
 *   - Always immediate (no scheduledAt).
 *   - Hard-defaults to push + sms; whatsapp added when the org plan
 *     enables it AND the per-recipient opt-in record exists.
 *   - Strict audit: `emergency_broadcast.sent` event always emitted,
 *     reason captured at send time.
 *
 * Implementation note: this service reuses the regular broadcast
 * service for the actual fan-out so we don't duplicate the
 * recipient-resolution + dispatch plumbing. The "emergency" framing
 * lives at THIS layer — channels enforced, scheduledAt forbidden,
 * audit row dedicated.
 */

import { BaseService } from "./base.service";
import { broadcastService } from "./broadcast.service";
import { eventRepository } from "@/repositories/event.repository";
import { eventBus } from "@/events/event-bus";
import { getRequestContext } from "@/context/request-context";
import { ConflictError } from "@/errors/app-error";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type {
  CommunicationChannel,
  EmergencyBroadcastDto,
  EmergencyBroadcastResult,
} from "@teranga/shared-types";

const HARD_DEFAULT_CHANNELS: readonly CommunicationChannel[] = ["push", "sms"];

function eventEnvelope(actorId: string) {
  const ctx = getRequestContext();
  return {
    actorId,
    requestId: ctx?.requestId ?? "unknown",
    timestamp: new Date().toISOString(),
  };
}

class EmergencyBroadcastService extends BaseService {
  async send(
    eventId: string,
    dto: EmergencyBroadcastDto,
    user: AuthUser,
  ): Promise<EmergencyBroadcastResult> {
    // Permission: requires `broadcast:send` AND `event:update` —
    // emergency sends are NOT for staff alone. Organizer or
    // co-organizer authority is required.
    this.requirePermission(user, "broadcast:send");
    this.requirePermission(user, "event:update");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    if (event.status !== "published") {
      throw new ConflictError("Les broadcasts d'urgence sont réservés aux événements publiés.");
    }

    // Enforce the hard-default channels — even if the operator
    // un-checked SMS by mistake in the dialog, the emergency must
    // land on push + sms at minimum.
    const channels = mergeChannels(dto.channels, HARD_DEFAULT_CHANNELS);

    // Delegate the actual send to the regular broadcast service —
    // we get recipient resolution + per-channel dispatch for free.
    const broadcast = await broadcastService.sendBroadcast(
      {
        eventId,
        title: dto.title,
        body: dto.body,
        channels,
        recipientFilter: "all",
      },
      user,
    );

    const perChannel: Record<string, number> = {};
    for (const channel of channels) {
      perChannel[channel] = broadcast.recipientCount;
    }

    eventBus.emit("emergency_broadcast.sent", {
      ...eventEnvelope(user.uid),
      eventId,
      organizationId: event.organizationId,
      reason: dto.reason,
      channels: [...channels],
      recipientCount: broadcast.recipientCount,
      dispatchedCount: broadcast.sentCount,
    });

    return {
      recipientCount: broadcast.recipientCount,
      dispatchedCount: broadcast.sentCount,
      perChannel,
    };
  }
}

/**
 * Pure helper: union of selected + hard-default channels, deduped,
 * order-preserving. Exported for unit tests so the contract is
 * pinned independently of the service.
 */
export function mergeChannels(
  selected: readonly CommunicationChannel[],
  hardDefaults: readonly CommunicationChannel[],
): CommunicationChannel[] {
  const seen = new Set<CommunicationChannel>();
  const out: CommunicationChannel[] = [];
  for (const ch of [...hardDefaults, ...selected]) {
    if (!seen.has(ch)) {
      seen.add(ch);
      out.push(ch);
    }
  }
  return out;
}

export const emergencyBroadcastService = new EmergencyBroadcastService();
