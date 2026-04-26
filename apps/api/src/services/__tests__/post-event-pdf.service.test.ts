import { describe, it, expect } from "vitest";
import { renderReportPdf } from "../post-event-pdf.service";
import type { PostEventReport } from "@teranga/shared-types";

// ─── PDF render smoke test ────────────────────────────────────────────────
//
// We can't easily diff PDF bytes (deterministic but binary), so the
// smoke test checks: (1) we get a Uint8Array that starts with the
// `%PDF-` magic, (2) the byte length is non-trivial (header + a few
// pages worth of content), and (3) rendering doesn't throw on the
// edge cases we care about (empty broadcasts / zero attendance / no
// `endDate`). pixel-perfect layout is fragile and out of scope.

const baseReport: PostEventReport = {
  eventId: "evt-1",
  organizationId: "org-1",
  eventTitle: "Hackathon Dakar 2026",
  eventStartDate: "2026-04-26T10:00:00.000Z",
  eventEndDate: "2026-04-26T18:00:00.000Z",
  attendance: {
    registered: 120,
    checkedIn: 96,
    cancelled: 4,
    noShow: 24,
    checkinRatePercent: 80,
  },
  demographics: {
    byTicketType: [
      { key: "tt-vip", label: "VIP", count: 10 },
      { key: "tt-std", label: "Standard", count: 86 },
    ],
    byAccessZone: [{ key: "z-main", label: "Salle principale", count: 96 }],
    byLanguage: [{ key: "fr", label: "Français", count: 96 }],
  },
  comms: {
    broadcastsSent: 3,
    totalRecipients: 360,
    totalDispatched: 350,
    totalFailed: 10,
    perChannel: [
      { key: "email", label: "Email", count: 300 },
      { key: "sms", label: "SMS", count: 100 },
    ],
  },
  financial: {
    grossAmount: 1_200_000,
    refundedAmount: 50_000,
    netRevenue: 1_150_000,
    platformFee: 57_500,
    payoutAmount: 1_092_500,
    paidRegistrations: 96,
    currency: "XOF",
  },
  computedAt: "2026-04-27T10:00:00.000Z",
  isFinal: true,
};

describe("renderReportPdf", () => {
  it("renders a valid PDF byte stream starting with the %PDF- magic", async () => {
    const bytes = await renderReportPdf(baseReport);
    expect(bytes).toBeInstanceOf(Uint8Array);
    // %PDF- = 0x25 0x50 0x44 0x46 0x2D
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
    expect(bytes[4]).toBe(0x2d);
    // A reasonable lower bound — empty pdf-lib pages are ~1KB.
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("renders without throwing on a zero-attendance event", async () => {
    const empty: PostEventReport = {
      ...baseReport,
      attendance: {
        registered: 0,
        checkedIn: 0,
        cancelled: 0,
        noShow: 0,
        checkinRatePercent: 0,
      },
      demographics: { byTicketType: [], byAccessZone: [], byLanguage: [] },
      comms: {
        broadcastsSent: 0,
        totalRecipients: 0,
        totalDispatched: 0,
        totalFailed: 0,
        perChannel: [],
      },
      financial: {
        grossAmount: 0,
        refundedAmount: 0,
        netRevenue: 0,
        platformFee: 0,
        payoutAmount: 0,
        paidRegistrations: 0,
        currency: "XOF",
      },
    };
    const bytes = await renderReportPdf(empty);
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("renders without throwing when endDate is null", async () => {
    const r: PostEventReport = { ...baseReport, eventEndDate: null };
    const bytes = await renderReportPdf(r);
    expect(bytes.length).toBeGreaterThan(2000);
  });
});
