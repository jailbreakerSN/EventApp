/**
 * Organizer overhaul — Phase O3.
 *
 * Computes a composite "Event Health Score" (0-100) plus a pacing
 * trajectory for a single event. Lets organizers detect at-risk
 * events 7 days earlier than the current "navigate-by-feel" model
 * (cf. PLAN.md §3.2 friction F11).
 *
 * The score is a sum of 7 weighted components — each pin a specific
 * preparation criterion. Components are self-contained: a missing
 * collection (e.g. broadcasts not yet implemented in production)
 * fails open with 0 points rather than tanking the whole score.
 *
 * Component weights (sum = 100):
 *
 *   publication        20  — event is `status: "published"`
 *   tickets            10  — at least one TicketType configured
 *   venue              10  — venueId set, OR format === "online" (no venue needed)
 *   pace               25  — registrations on / above expected curve
 *   comms              15  — at least one broadcast emitted on this event
 *   staff              10  — org has at least one user with role "staff"
 *   checkin            10  — templateId set (badge template assigned)
 *
 * The pacing trajectory expresses cumulative-registrations-vs-time
 * as two daily-bucketed series:
 *
 *   actual    : how many registrations had landed by day D (cumulative)
 *   expected  : where the standard event-registration curve says we
 *               SHOULD have been on day D, scaled to the event's
 *               capacity target.
 *
 * Both series share the same X axis: the day window from publishedAt
 * (or createdAt) to startDate, capped at 30 days. The frontend
 * `<PacingChart>` renders the two as overlaid SVG lines.
 *
 * The default expected curve mirrors the "slow ramp + late spike"
 * shape of typical Senegalese event registrations (anecdotally
 * observed: 5-10% in the first half, the rest flooding in the last
 * 25% of the window):
 *
 *   t = 0.00  →  0%
 *   t = 0.50  →  20%
 *   t = 0.75  →  50%
 *   t = 0.90  →  80%
 *   t = 1.00  →  100%
 *
 * Linear interpolation between these checkpoints. Future Phase O3+
 * iterations may swap this for a per-organisation historical curve
 * once we have enough completed events to learn from.
 */

import { BaseService } from "./base.service";
import { db, COLLECTIONS } from "@/config/firebase";
import { eventRepository } from "@/repositories/event.repository";
import { registrationRepository } from "@/repositories/registration.repository";
import type { AuthUser } from "@/middlewares/auth.middleware";
import type { Event, Registration } from "@teranga/shared-types";

export type HealthComponentKey =
  | "publication"
  | "tickets"
  | "venue"
  | "pace"
  | "comms"
  | "staff"
  | "checkin";

export interface HealthComponent {
  key: HealthComponentKey;
  /** Earned points (0 ≤ earned ≤ max). */
  earned: number;
  /** Maximum points this component can contribute. */
  max: number;
  /** Short French label for the gauge tooltip / legend. */
  label: string;
  /** Why the component scored what it did (operator-facing rationale). */
  detail: string;
}

export interface PacingPoint {
  /** ISO date (YYYY-MM-DD) — one bucket per day. */
  date: string;
  /** Days from publishedAt (0 = day of publication). */
  dayIndex: number;
  /** Cumulative actual registrations by end of this day. */
  actual: number;
  /** Cumulative expected registrations by end of this day. */
  expected: number;
}

export interface EventHealthSnapshot {
  eventId: string;
  /** Total composite score 0-100. */
  score: number;
  /**
   * High-level severity tier — used by the gauge to pick the colour
   * band and by the inbox to decide whether to surface a signal.
   *
   *   excellent  : 80+
   *   healthy    : 60-79
   *   at-risk    : 40-59
   *   critical   : 0-39
   */
  tier: "critical" | "at_risk" | "healthy" | "excellent";
  components: HealthComponent[];
  pacing: PacingPoint[];
  /**
   * Pacing performance ratio: actual / expected at the current day,
   * expressed as a percentage. < 70 = at risk (used by inbox alert).
   * Null when the event is too early (< 1 day after publication) or
   * has no expected baseline (no startDate / no capacity target).
   */
  pacingPercent: number | null;
  computedAt: string;
}

const DEFAULT_TARGET_CAPACITY = 50;

const PACING_CURVE: ReadonlyArray<{ t: number; pct: number }> = [
  { t: 0, pct: 0 },
  { t: 0.5, pct: 0.2 },
  { t: 0.75, pct: 0.5 },
  { t: 0.9, pct: 0.8 },
  { t: 1, pct: 1 },
];

/**
 * Linear-interpolate the expected adoption percentage for a given
 * normalised time `t` ∈ [0, 1] using `PACING_CURVE`. Exported for
 * unit tests so the curve shape is pinned independently of the
 * service's I/O.
 */
export function expectedPercent(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  for (let i = 1; i < PACING_CURVE.length; i++) {
    const left = PACING_CURVE[i - 1];
    const right = PACING_CURVE[i];
    if (t <= right.t) {
      const span = right.t - left.t;
      const frac = span === 0 ? 0 : (t - left.t) / span;
      return left.pct + frac * (right.pct - left.pct);
    }
  }
  return 1;
}

/**
 * Build the daily pacing series from a registration list + event window.
 *
 * Pure helper, exported for unit testing — the service simply hands
 * it the raw inputs and re-exposes the result.
 */
export function buildPacingSeries(args: {
  registrations: ReadonlyArray<Pick<Registration, "createdAt" | "status">>;
  publishedAt: string | null;
  startDate: string;
  now: Date;
  targetCapacity: number;
}): PacingPoint[] {
  const { registrations, publishedAt, startDate, now, targetCapacity } = args;

  const startMs = new Date(startDate).getTime();
  const publishMs = publishedAt
    ? new Date(publishedAt).getTime()
    : // Fallback: 30 days before the event if we have no publishedAt.
      startMs - 30 * 24 * 60 * 60 * 1000;

  const totalSpanMs = startMs - publishMs;
  if (totalSpanMs <= 0) return [];

  const nowMs = Math.min(now.getTime(), startMs);
  const elapsedDays = Math.max(0, Math.floor((nowMs - publishMs) / (24 * 60 * 60 * 1000)));
  // Cap the visible window at 30 days for chart legibility — for an
  // event published 90 days out, the first 60 days are uneventful and
  // would compress the meaningful tail.
  const windowDays = Math.min(elapsedDays + 1, 30);

  // Pre-bucket registrations by day index so cumulation is O(R + windowDays).
  const dailyBuckets = new Map<number, number>();
  const validStatuses = new Set(["confirmed", "checked_in", "waitlisted"]);
  for (const reg of registrations) {
    if (!validStatuses.has(reg.status)) continue;
    const created = new Date(reg.createdAt).getTime();
    const dayIndex = Math.floor((created - publishMs) / (24 * 60 * 60 * 1000));
    if (dayIndex < 0) continue; // pre-publication outliers (rare, defensive)
    dailyBuckets.set(dayIndex, (dailyBuckets.get(dayIndex) ?? 0) + 1);
  }

  const points: PacingPoint[] = [];
  let cumulative = 0;
  const startOffset = Math.max(0, elapsedDays - windowDays + 1);
  for (let i = 0; i < windowDays; i++) {
    const dayIndex = startOffset + i;
    cumulative =
      i === 0
        ? // Sum any registrations from earlier days too — the chart
          // starts at "actual count on the first visible day", not at 0.
          Array.from(dailyBuckets.entries())
            .filter(([d]) => d <= dayIndex)
            .reduce((acc, [, n]) => acc + n, 0)
        : cumulative + (dailyBuckets.get(dayIndex) ?? 0);

    const dayMs = publishMs + dayIndex * 24 * 60 * 60 * 1000;
    const t = totalSpanMs > 0 ? Math.min(1, (dayMs - publishMs) / totalSpanMs) : 0;
    const expected = Math.round(expectedPercent(t) * targetCapacity);

    points.push({
      date: new Date(dayMs).toISOString().slice(0, 10),
      dayIndex,
      actual: cumulative,
      expected,
    });
  }

  return points;
}

class EventHealthService extends BaseService {
  /**
   * Compute the full health snapshot for a single event. Read-only,
   * safe to poll from the frontend.
   *
   * Permission gate: `event:read` + `requireOrganizationAccess`.
   */
  async getEventHealth(eventId: string, user: AuthUser): Promise<EventHealthSnapshot> {
    this.requirePermission(user, "event:read");

    const event = await eventRepository.findByIdOrThrow(eventId);
    this.requireOrganizationAccess(user, event.organizationId);

    const now = new Date();

    // Run the side queries in parallel: broadcasts count, staff count,
    // and the registration list (used by both pace + pacing series).
    const [broadcastCount, staffCount, registrationsResult] = await Promise.all([
      this.safeCountBroadcasts(eventId),
      this.safeCountOrgStaff(event.organizationId),
      registrationRepository.findByEvent(eventId, ["confirmed", "checked_in", "waitlisted"], {
        page: 1,
        limit: 1000,
      }),
    ]);

    const registrations = registrationsResult.data;

    const components = computeComponents({
      event,
      broadcastCount,
      staffCount,
      registeredCount: countConfirmed(registrations),
      now,
    });

    const score = components.reduce((sum, c) => sum + c.earned, 0);
    const tier = scoreTier(score);

    const targetCapacity = effectiveCapacity(event);
    const pacing = buildPacingSeries({
      registrations,
      publishedAt: event.publishedAt ?? null,
      startDate: event.startDate,
      now,
      targetCapacity,
    });

    const pacingPercent = computePacingPercent(pacing);

    return {
      eventId,
      score,
      tier,
      components,
      pacing,
      pacingPercent,
      computedAt: now.toISOString(),
    };
  }

  private async safeCountBroadcasts(eventId: string): Promise<number> {
    try {
      const snap = await db
        .collection(COLLECTIONS.BROADCASTS)
        .where("eventId", "==", eventId)
        .count()
        .get();
      return snap.data().count;
    } catch (err) {
      process.stderr.write(
        `[event-health] broadcasts count failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 0;
    }
  }

  private async safeCountOrgStaff(organizationId: string): Promise<number> {
    try {
      const snap = await db
        .collection(COLLECTIONS.USERS)
        .where("organizationId", "==", organizationId)
        .where("roles", "array-contains", "staff")
        .count()
        .get();
      return snap.data().count;
    } catch (err) {
      process.stderr.write(
        `[event-health] staff count failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 0;
    }
  }
}

// ─── Pure helpers (exported for unit tests) ──────────────────────────────────

export function effectiveCapacity(event: Pick<Event, "maxAttendees" | "registeredCount">): number {
  if (event.maxAttendees && event.maxAttendees > 0) return event.maxAttendees;
  // No hard cap → use a soft target of 1.2× current registrations or
  // the default fallback, whichever is higher. This keeps the pacing
  // chart meaningful for events that explicitly opted out of capacity
  // limits (e.g. open conferences).
  const soft = Math.max(DEFAULT_TARGET_CAPACITY, Math.ceil(event.registeredCount * 1.2));
  return soft;
}

function countConfirmed(registrations: ReadonlyArray<Pick<Registration, "status">>): number {
  return registrations.filter((r) => r.status === "confirmed" || r.status === "checked_in").length;
}

export function scoreTier(score: number): EventHealthSnapshot["tier"] {
  if (score >= 80) return "excellent";
  if (score >= 60) return "healthy";
  if (score >= 40) return "at_risk";
  return "critical";
}

export function computePacingPercent(pacing: ReadonlyArray<PacingPoint>): number | null {
  if (pacing.length === 0) return null;
  const last = pacing[pacing.length - 1];
  if (last.expected <= 0) return null;
  return Math.round((last.actual / last.expected) * 100);
}

interface ComponentInputs {
  event: Pick<
    Event,
    | "status"
    | "ticketTypes"
    | "venueId"
    | "format"
    | "templateId"
    | "startDate"
    | "publishedAt"
    | "maxAttendees"
    | "registeredCount"
  >;
  broadcastCount: number;
  staffCount: number;
  registeredCount: number;
  now: Date;
}

export function computeComponents(input: ComponentInputs): HealthComponent[] {
  const { event, broadcastCount, staffCount, registeredCount, now } = input;
  const components: HealthComponent[] = [];

  // 1. Publication (20)
  components.push({
    key: "publication",
    label: "Publication",
    max: 20,
    earned: event.status === "published" ? 20 : 0,
    detail:
      event.status === "published"
        ? "Événement publié — visible aux participants."
        : "Événement non publié — l'inscription est fermée.",
  });

  // 2. Tickets (10)
  const hasTickets = (event.ticketTypes?.length ?? 0) > 0;
  components.push({
    key: "tickets",
    label: "Billetterie",
    max: 10,
    earned: hasTickets ? 10 : 0,
    detail: hasTickets
      ? `${event.ticketTypes?.length ?? 0} type(s) de billet configuré(s).`
      : "Aucun billet configuré — créez au moins une catégorie.",
  });

  // 3. Venue (10) — online events skip the requirement.
  const isOnline = event.format === "online";
  const hasVenue = isOnline || Boolean(event.venueId);
  components.push({
    key: "venue",
    label: "Lieu",
    max: 10,
    earned: hasVenue ? 10 : 0,
    detail: isOnline
      ? "Événement en ligne — aucun lieu physique requis."
      : event.venueId
        ? "Lieu confirmé."
        : "Aucun lieu confirmé — ajoutez un lieu avant J-7.",
  });

  // 4. Pace (25)
  const targetCapacity = effectiveCapacity(event);
  const pubMs = event.publishedAt
    ? new Date(event.publishedAt).getTime()
    : new Date(event.startDate).getTime() - 30 * 24 * 60 * 60 * 1000;
  const startMs = new Date(event.startDate).getTime();
  const total = startMs - pubMs;
  const elapsed = Math.max(0, Math.min(now.getTime() - pubMs, total));
  const t = total > 0 ? elapsed / total : 0;
  const expectedFraction = expectedPercent(t);
  const expectedCount = Math.max(1, expectedFraction * targetCapacity);
  const actualOverExpected = registeredCount / expectedCount;
  // Award earned proportional to (actual / expected), capped at 100% so
  // an event well ahead of pace still gets the full 25 (no negative
  // signal for over-performing).
  const paceRatio = Math.min(1, Math.max(0, actualOverExpected));
  components.push({
    key: "pace",
    label: "Rythme d'inscription",
    max: 25,
    earned: Math.round(paceRatio * 25),
    detail:
      expectedFraction === 0
        ? "Trop tôt pour évaluer le rythme."
        : `${registeredCount} inscrits / ${Math.round(expectedCount)} attendus à ce stade (${Math.round(actualOverExpected * 100)} %).`,
  });

  // 5. Comms (15)
  components.push({
    key: "comms",
    label: "Communications",
    max: 15,
    earned: broadcastCount > 0 ? 15 : 0,
    detail:
      broadcastCount > 0
        ? `${broadcastCount} broadcast(s) envoyé(s) à ce jour.`
        : "Aucune communication envoyée — planifiez un rappel.",
  });

  // 6. Staff (10)
  components.push({
    key: "staff",
    label: "Équipe staff",
    max: 10,
    earned: staffCount > 0 ? 10 : 0,
    detail:
      staffCount > 0
        ? `${staffCount} membre(s) staff disponible(s) dans l'organisation.`
        : "Aucun membre staff disponible — invitez au moins un scanneur.",
  });

  // 7. Checkin (10)
  components.push({
    key: "checkin",
    label: "Check-in prêt",
    max: 10,
    earned: event.templateId ? 10 : 0,
    detail: event.templateId
      ? "Modèle de badge assigné — la génération est prête."
      : "Aucun modèle de badge — créez-en un avant J-1.",
  });

  return components;
}

export const eventHealthService = new EventHealthService();
