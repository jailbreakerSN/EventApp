import { describe, it, expect } from "vitest";
import {
  computeAttendance,
  computeCommsPerformance,
  computeDemographics,
  isEventFinal,
} from "../post-event-report.service";
import type { Broadcast, Event, Registration, UserProfile } from "@teranga/shared-types";

// ─── Pure aggregation helpers — pinned outside of Firestore ──────────────
//
// The service has 3 main aggregations: attendance, demographics, comms.
// Each is a pure function fed by the parallel reads. We test them
// independently here. The integration with Firestore + the audit emit
// is covered by the route-level tests (`fastify.inject`).

const baseRegistration: Registration = {
  id: "reg-1",
  eventId: "evt-1",
  userId: "u-1",
  ticketTypeId: "tt-vip",
  status: "confirmed",
  qrCodeValue: "qr-1",
  checkedInAt: null,
  checkedInBy: null,
  accessZoneId: null,
  notes: null,
  createdAt: "2026-04-01T10:00:00.000Z",
  updatedAt: "2026-04-01T10:00:00.000Z",
};

describe("isEventFinal — temporal gate", () => {
  // The helper accepts `Pick<Event, "startDate"> & { endDate?: string | null }`
  // — we use a permissive shape so legacy rows without an explicit
  // endDate still resolve through the 12h fallback.
  type EvtFixture = { startDate: string; endDate?: string | null };
  const evt = (over: Partial<EvtFixture>): EvtFixture => ({
    startDate: "2026-04-26T10:00:00.000Z",
    endDate: "2026-04-26T18:00:00.000Z",
    ...over,
  });

  it("returns false when `now` is before the end date", () => {
    expect(isEventFinal(evt({}), new Date("2026-04-26T15:00:00.000Z"))).toBe(false);
  });

  it("returns true when `now` is past the end date", () => {
    expect(isEventFinal(evt({}), new Date("2026-04-26T19:00:00.000Z"))).toBe(true);
  });

  it("falls back to start + 12 h when endDate is null", () => {
    const e = evt({ endDate: null });
    expect(isEventFinal(e, new Date("2026-04-26T22:30:00.000Z"))).toBe(true);
    expect(isEventFinal(e, new Date("2026-04-26T20:00:00.000Z"))).toBe(false);
  });
});

describe("computeAttendance", () => {
  it("counts confirmed + checked_in toward `registered`, exclusive of cancelled", () => {
    const regs: Registration[] = [
      { ...baseRegistration, id: "r1", status: "confirmed" },
      {
        ...baseRegistration,
        id: "r2",
        status: "checked_in",
        checkedInAt: "2026-04-26T10:30:00.000Z",
      },
      { ...baseRegistration, id: "r3", status: "cancelled" },
    ];
    const out = computeAttendance(regs, true);
    expect(out.registered).toBe(2);
    expect(out.checkedIn).toBe(1);
    expect(out.cancelled).toBe(1);
    expect(out.checkinRatePercent).toBe(50);
  });

  it("returns noShow=0 before the event ends, even if some are not checked in", () => {
    const regs: Registration[] = [
      { ...baseRegistration, id: "r1", status: "confirmed" },
      { ...baseRegistration, id: "r2", status: "confirmed" },
    ];
    const out = computeAttendance(regs, false);
    expect(out.noShow).toBe(0);
  });

  it("returns noShow = registered − checkedIn once the event has ended", () => {
    const regs: Registration[] = [
      { ...baseRegistration, id: "r1", status: "confirmed" },
      {
        ...baseRegistration,
        id: "r2",
        status: "checked_in",
        checkedInAt: "2026-04-26T10:30:00.000Z",
      },
    ];
    const out = computeAttendance(regs, true);
    expect(out.noShow).toBe(1);
  });

  it("treats checkedInAt presence as 'attended' even if status didn't transition", () => {
    // Edge case: a stale write left status="confirmed" but checkedInAt
    // was set. The aggregation favours the timestamp.
    const regs: Registration[] = [
      {
        ...baseRegistration,
        id: "r1",
        status: "confirmed",
        checkedInAt: "2026-04-26T10:30:00.000Z",
      },
    ];
    const out = computeAttendance(regs, true);
    expect(out.checkedIn).toBe(1);
  });

  it("returns 0% checkin rate on an empty event without dividing by zero", () => {
    const out = computeAttendance([], true);
    expect(out.checkinRatePercent).toBe(0);
    expect(out.noShow).toBe(0);
  });
});

describe("computeDemographics", () => {
  const event: Pick<Event, "ticketTypes" | "accessZones"> = {
    ticketTypes: [
      {
        id: "tt-vip",
        name: "VIP",
        price: 50000,
        totalQuantity: 50,
        currency: "XOF",
        soldCount: 0,
        accessZoneIds: [],
        isVisible: true,
      },
      {
        id: "tt-std",
        name: "Standard",
        price: 10000,
        totalQuantity: 1000,
        currency: "XOF",
        soldCount: 0,
        accessZoneIds: [],
        isVisible: true,
      },
    ] as Event["ticketTypes"],
    accessZones: [{ id: "z-main", name: "Salle principale" }] as Event["accessZones"],
  };

  it("groups registrations by ticket type and labels via the event's ticketTypes", () => {
    const regs: Registration[] = [
      { ...baseRegistration, id: "r1", ticketTypeId: "tt-vip" },
      { ...baseRegistration, id: "r2", ticketTypeId: "tt-vip" },
      { ...baseRegistration, id: "r3", ticketTypeId: "tt-std" },
    ];
    const out = computeDemographics(regs, event, new Map());
    const vip = out.byTicketType.find((r) => r.key === "tt-vip")!;
    expect(vip.label).toBe("VIP");
    expect(vip.count).toBe(2);
    // Sorted DESC by count.
    expect(out.byTicketType[0].key).toBe("tt-vip");
  });

  it("excludes cancelled registrations from every breakdown", () => {
    const regs: Registration[] = [
      { ...baseRegistration, id: "r1", ticketTypeId: "tt-vip" },
      { ...baseRegistration, id: "r2", ticketTypeId: "tt-vip", status: "cancelled" },
    ];
    const out = computeDemographics(regs, event, new Map());
    expect(out.byTicketType.find((r) => r.key === "tt-vip")?.count).toBe(1);
  });

  it("attaches user language via the usersById map (falls back to 'fr')", () => {
    const regs: Registration[] = [
      { ...baseRegistration, id: "r1", userId: "u-1" },
      { ...baseRegistration, id: "r2", userId: "u-2" },
      { ...baseRegistration, id: "r3", userId: "u-3" },
    ];
    const usersById = new Map<string, Pick<UserProfile, "preferredLanguage">>([
      ["u-1", { preferredLanguage: "fr" }],
      ["u-2", { preferredLanguage: "wo" }],
      // u-3 missing → falls back to "fr".
    ]);
    const out = computeDemographics(regs, event, usersById);
    const fr = out.byLanguage.find((r) => r.key === "fr")!;
    const wo = out.byLanguage.find((r) => r.key === "wo")!;
    expect(fr.count).toBe(2);
    expect(wo.count).toBe(1);
    expect(fr.label).toBe("Français");
    expect(wo.label).toBe("Wolof");
  });
});

describe("computeCommsPerformance", () => {
  const baseBroadcast: Broadcast = {
    id: "b-1",
    eventId: "evt-1",
    organizationId: "org-1",
    title: "T",
    body: "B",
    channels: ["email"],
    recipientFilter: "all",
    recipientCount: 100,
    sentCount: 95,
    failedCount: 5,
    status: "sent",
    scheduledAt: null,
    createdBy: "u-1",
    createdAt: "2026-04-01T10:00:00.000Z",
    sentAt: "2026-04-01T10:01:00.000Z",
  };

  it("only counts broadcasts in 'sent' status", () => {
    const out = computeCommsPerformance([
      { ...baseBroadcast, id: "b1", status: "sent" },
      { ...baseBroadcast, id: "b2", status: "draft" },
      { ...baseBroadcast, id: "b3", status: "scheduled" },
    ]);
    expect(out.broadcastsSent).toBe(1);
  });

  it("sums recipientCount + sentCount + failedCount across sent broadcasts", () => {
    const out = computeCommsPerformance([
      { ...baseBroadcast, id: "b1", recipientCount: 100, sentCount: 95, failedCount: 5 },
      { ...baseBroadcast, id: "b2", recipientCount: 50, sentCount: 50, failedCount: 0 },
    ]);
    expect(out.totalRecipients).toBe(150);
    expect(out.totalDispatched).toBe(145);
    expect(out.totalFailed).toBe(5);
  });

  it("attributes the sentCount to every channel of each broadcast", () => {
    const out = computeCommsPerformance([
      { ...baseBroadcast, id: "b1", channels: ["email", "sms"], sentCount: 100 },
      { ...baseBroadcast, id: "b2", channels: ["email"], sentCount: 50 },
    ]);
    const email = out.perChannel.find((c) => c.key === "email")!;
    const sms = out.perChannel.find((c) => c.key === "sms")!;
    expect(email.count).toBe(150);
    expect(sms.count).toBe(100);
    // Sorted DESC by count.
    expect(out.perChannel[0].key).toBe("email");
  });
});
