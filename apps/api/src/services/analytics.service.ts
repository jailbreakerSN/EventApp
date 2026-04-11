import {
  type AnalyticsQuery,
  type AnalyticsTimeframe,
  type OrgAnalytics,
  type TimeSeriesPoint,
  type Event,
  type Registration,
} from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";

function getTimeframeStartDate(timeframe: AnalyticsTimeframe): Date | null {
  const now = new Date();
  switch (timeframe) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "12m":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "all":
      return null;
  }
}

function groupByDate(items: { date: string }[]): TimeSeriesPoint[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const day = item.date.slice(0, 10); // YYYY-MM-DD
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

export class AnalyticsService extends BaseService {
  async getOrgAnalytics(
    orgId: string,
    query: AnalyticsQuery,
    user: AuthUser,
  ): Promise<OrgAnalytics> {
    this.requirePermission(user, "event:read");
    this.requireOrganizationAccess(user, orgId);

    const timeframe = query.timeframe ?? "30d";
    const startDate = getTimeframeStartDate(timeframe);

    // Fetch org events (capped at 500 to prevent unbounded reads)
    const MAX_EVENTS = 500;
    const MAX_REGISTRATIONS = 10_000;

    let eventsQuery = db
      .collection(COLLECTIONS.EVENTS)
      .where("organizationId", "==", orgId)
      .limit(MAX_EVENTS);

    if (query.eventId) {
      eventsQuery = db
        .collection(COLLECTIONS.EVENTS)
        .where("organizationId", "==", orgId)
        .where("__name__", "==", query.eventId);
    }

    const eventsSnap = await eventsQuery.get();
    const events = eventsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Event);
    const eventIds = events.map((e) => e.id);

    // Build event lookup map for O(1) access in aggregation
    const eventMap = new Map<string, Event>();
    for (const event of events) {
      eventMap.set(event.id, event);
    }

    // Fetch registrations for these events (capped)
    const registrations: Registration[] = [];
    if (eventIds.length > 0) {
      // Firestore "in" operator max 30 items — batch if needed
      const batches = [];
      for (let i = 0; i < eventIds.length; i += 30) {
        batches.push(eventIds.slice(i, i + 30));
      }

      for (const batch of batches) {
        if (registrations.length >= MAX_REGISTRATIONS) break;

        let regQuery = db
          .collection(COLLECTIONS.REGISTRATIONS)
          .where("eventId", "in", batch)
          .limit(MAX_REGISTRATIONS - registrations.length);

        if (startDate) {
          regQuery = regQuery.where("createdAt", ">=", startDate.toISOString());
        }

        const snap = await regQuery.get();
        registrations.push(
          ...snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Registration),
        );
      }
    }

    // Filter events by timeframe for the summary
    const filteredEvents = startDate
      ? events.filter((e) => new Date(e.createdAt) >= startDate)
      : events;

    // Compute summary
    const totalRegistrations = registrations.length;
    const confirmedOrCheckedIn = registrations.filter(
      (r) => r.status === "confirmed" || r.status === "checked_in",
    );
    const totalCheckedIn = registrations.filter((r) => r.status === "checked_in").length;
    const totalCancelled = registrations.filter((r) => r.status === "cancelled").length;
    const checkinRate =
      confirmedOrCheckedIn.length > 0 ? totalCheckedIn / confirmedOrCheckedIn.length : 0;

    // Time series
    const registrationsOverTime = groupByDate(registrations.map((r) => ({ date: r.createdAt })));

    const checkinsOverTime = groupByDate(
      registrations.filter((r) => r.checkedInAt).map((r) => ({ date: r.checkedInAt! })),
    );

    // By category
    const categoryMap = new Map<string, number>();
    for (const event of filteredEvents) {
      categoryMap.set(event.category, (categoryMap.get(event.category) ?? 0) + 1);
    }
    const byCategory = Array.from(categoryMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    // By ticket type (using eventMap for O(1) lookup)
    const ticketMap = new Map<string, { registered: number; checkedIn: number }>();
    for (const reg of registrations) {
      const event = eventMap.get(reg.eventId);
      const ticketType = event?.ticketTypes.find((t) => t.id === reg.ticketTypeId);
      const name = ticketType?.name ?? "Unknown";

      const existing = ticketMap.get(name) ?? { registered: 0, checkedIn: 0 };
      existing.registered++;
      if (reg.status === "checked_in") existing.checkedIn++;
      ticketMap.set(name, existing);
    }
    const byTicketType = Array.from(ticketMap.entries())
      .map(([ticketTypeName, data]) => ({ ticketTypeName, ...data }))
      .sort((a, b) => b.registered - a.registered);

    // Top events
    const topEvents = events
      .filter((e) => e.status !== "archived" && e.status !== "cancelled")
      .sort((a, b) => b.registeredCount - a.registeredCount)
      .slice(0, 10)
      .map((e) => ({
        eventId: e.id,
        title: e.title,
        registeredCount: e.registeredCount,
        checkedInCount: e.checkedInCount,
      }));

    return {
      organizationId: orgId,
      timeframe,
      summary: {
        totalEvents: filteredEvents.length,
        totalRegistrations,
        totalCheckedIn,
        totalCancelled,
        checkinRate: Math.round(checkinRate * 100) / 100,
      },
      registrationsOverTime,
      checkinsOverTime,
      byCategory,
      byTicketType,
      topEvents,
    };
  }
}

export const analyticsService = new AnalyticsService();
