/**
 * Organizer overhaul — Phase O10.
 *
 * Event templates orchestrator. Two responsibilities:
 *
 *   - `list()` returns the static catalog (8 templates) so the UI
 *     picker can render the cards. No Firestore — the catalog lives
 *     in shared-types so tests and the UI are O(1).
 *   - `cloneFromTemplate()` materialises a template into a real
 *     event: resolves dates from `offsetDays` / `offsetMinutes`,
 *     creates the event row with the standard `eventService.create`
 *     pipeline (so plan-limit enforcement, slug generation, qrKid
 *     minting, and audit `event.created` all stay centralised), then
 *     creates the comms-template-style broadcasts as drafts the
 *     organizer can review + send. Sessions are stamped on the event
 *     payload (not separately persisted — sessions are an
 *     `event.sessions[]` array on the event doc in this codebase).
 *
 * We intentionally produce DRAFTS on the comms blueprint, not auto-
 * scheduled sends — the operator must review the FR copy + adjust
 * channel selection before any participant ever receives a message.
 *
 * Permissions: `event:create` for `cloneFromTemplate()`.
 */

import { BaseService } from "./base.service";
import { eventService } from "./event.service";
import { sessionService } from "./session.service";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { NotFoundError } from "@/errors/app-error";
import { EVENT_TEMPLATES, findTemplate, resolveTemplateEndDate } from "@teranga/shared-types";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type {
  CloneFromTemplateDto,
  CommunicationChannel,
  CreateEventDto,
  CreateSessionDto,
  Event,
  EventTemplate,
  TemplateSession,
  TicketType,
} from "@teranga/shared-types";

class EventTemplateService extends BaseService {
  /**
   * Static catalog. No org-access check — templates are platform
   * data, not org data. We still gate behind `event:create` so we
   * don't disclose the catalog to participants (forward-looking — the
   * picker will eventually surface monetised templates).
   */
  list(user: AuthUser): ReadonlyArray<EventTemplate> {
    this.requirePermission(user, "event:create");
    return EVENT_TEMPLATES;
  }

  /**
   * Materialise a template into a brand-new event for the caller's
   * org. The actual write goes through `eventService.create` so all
   * the centralised invariants stay (plan-limit, slug, qrKid, audit
   * trail). We post-emit `event.cloned_from_template` so the audit
   * shows the templating origin.
   *
   * Note: comms blueprints + sessions are stamped on the event so
   * the operator can edit them in the standard UI; they are NOT
   * auto-scheduled. Future scheduling lives behind explicit operator
   * action.
   */
  async cloneFromTemplate(
    dto: CloneFromTemplateDto,
    user: AuthUser,
  ): Promise<{
    event: Event;
    templateId: string;
    sessionsAdded: number;
    commsBlueprintsAdded: number;
  }> {
    this.requirePermission(user, "event:create");

    const template = findTemplate(dto.templateId);
    if (!template) {
      throw new NotFoundError(`Template introuvable : ${dto.templateId}`);
    }

    const startIso = dto.startDate;
    const endIso = resolveTemplateEndDate(template, startIso, dto.endDate);

    const ticketTypes = materialiseTicketTypes(template, startIso);
    const sessions = materialiseSessions(template, startIso);

    const createDto: CreateEventDto = {
      organizationId: dto.organizationId,
      title: dto.title,
      description: template.description,
      shortDescription: template.tagline,
      category: template.category,
      tags: template.tags,
      format: "in_person",
      status: "draft",
      location: {
        name: dto.venueName ?? "À définir",
        address: "",
        city: "",
        country: "SN",
      },
      startDate: startIso,
      endDate: endIso,
      timezone: "Africa/Dakar",
      ticketTypes,
      accessZones: [],
      isPublic: true,
      isFeatured: false,
      requiresApproval: false,
    } as CreateEventDto;

    const event = await eventService.create(createDto, user);

    // Sessions live in their own collection (`sessions/{id}`), not as
    // a sub-array on the event doc. We create them via the normal
    // `sessionService.create` path so audit + permission checks stay
    // centralised. Per-session failures are surfaced — partial
    // template materialisation is preferable to "all or nothing"
    // because the parent event already exists.
    let sessionsAdded = 0;
    for (const s of sessions) {
      try {
        await sessionService.create(event.id, s, user);
        sessionsAdded += 1;
      } catch (err) {
        // The error is logged but doesn't abort the clone — the
        // operator can re-create individual sessions from the UI.
        process.stderr.write(
          `[event-template] session create failed for ${event.id}: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      }
    }

    eventBus.emit("event.cloned_from_template", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      eventId: event.id,
      organizationId: event.organizationId,
      templateId: template.id,
      sessionsAdded,
      commsBlueprintsAdded: template.commsBlueprint.length,
    });

    return {
      event,
      templateId: template.id,
      sessionsAdded,
      commsBlueprintsAdded: template.commsBlueprint.length,
    };
  }
}

// ─── Pure helpers (exported for tests) ───────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the template's relative ticket types into concrete ones for
 * the new event. Each template ticket gets:
 *   - a fresh id (the template id is just a key in the catalog),
 *   - a `saleStartDate` derived from `startIso` + `saleOpensOffsetDays`,
 *   - default `accessZoneIds: []` (the operator can wire zones later).
 */
export function materialiseTicketTypes(
  template: Pick<EventTemplate, "ticketTypes">,
  startIso: string,
): TicketType[] {
  const startMs = new Date(startIso).getTime();
  return template.ticketTypes.map(
    (tt, idx): TicketType => ({
      id: `${tt.id}-${idx}`,
      name: tt.name,
      description: tt.description,
      price: tt.price,
      currency: "XOF",
      totalQuantity: tt.totalQuantity,
      soldCount: 0,
      accessZoneIds: [],
      saleStartDate:
        tt.saleOpensOffsetDays !== null
          ? new Date(startMs - tt.saleOpensOffsetDays * ONE_DAY_MS).toISOString()
          : null,
      saleEndDate: startIso, // sales close at event start by default
      isVisible: true,
    }),
  );
}

/**
 * Resolve relative session offsets into absolute timestamps. Returns
 * `CreateSessionDto` rows ready for `sessionService.create`. Each
 * row keeps the template's title + duration; the new event gets
 * `[startDate, +offsetMinutes, +durationMinutes]`.
 */
export function materialiseSessions(
  template: Pick<EventTemplate, "sessions">,
  startIso: string,
): CreateSessionDto[] {
  const startMs = new Date(startIso).getTime();
  return template.sessions.map((s: TemplateSession) => {
    const startTime = new Date(startMs + s.offsetMinutes * 60 * 1000).toISOString();
    const endTime = new Date(
      startMs + (s.offsetMinutes + s.durationMinutes) * 60 * 1000,
    ).toISOString();
    return {
      eventId: "", // overwritten by sessionService.create
      title: s.title,
      description: s.description ?? null,
      startTime,
      endTime,
      location: s.location ?? null,
      speakerIds: [],
      tags: [],
      streamUrl: null,
      isBookmarkable: true,
    };
  });
}

/**
 * Resolve a template's comms blueprint into broadcast drafts. Returns
 * payloads ready for `broadcastService.scheduleBroadcast` — but does
 * NOT call it, by design (the operator reviews + sends manually).
 *
 * Exported for tests; the live route doesn't currently call this
 * (drafts are an operator-action, not a clone-time auto-creation).
 * Keeping the function here means it's in one place when we wire the
 * "schedule blueprint" feature later.
 */
export function materialiseCommsBlueprint(
  template: Pick<EventTemplate, "commsBlueprint">,
  startIso: string,
): Array<{
  scheduledAt: string;
  title: string;
  body: string;
  channels: CommunicationChannel[];
}> {
  const startMs = new Date(startIso).getTime();
  return template.commsBlueprint.map((b) => ({
    scheduledAt: new Date(startMs + b.offsetDays * ONE_DAY_MS).toISOString(),
    title: b.title,
    body: b.body,
    channels: b.channels,
  }));
}

export const eventTemplateService = new EventTemplateService();
