import { describe, it, expect } from "vitest";
import {
  materialiseTicketTypes,
  materialiseSessions,
  materialiseCommsBlueprint,
} from "../event-template.service";
import { EVENT_TEMPLATES, findTemplate, resolveTemplateEndDate } from "@teranga/shared-types";

// ─── Event template catalog + materialisation helpers ─────────────────────
//
// The service mostly delegates to `eventService.create` + `sessionService.create`,
// so the testable surface is the catalog (8 templates) and the pure
// helpers that resolve relative offsets into absolute timestamps.

describe("EVENT_TEMPLATES catalog", () => {
  it("exports exactly 8 templates", () => {
    expect(EVENT_TEMPLATES).toHaveLength(8);
  });

  it("every template has a unique kebab-case id", () => {
    const ids = EVENT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("every template has a non-empty label, tagline, description, icon, and at least one ticket type", () => {
    for (const t of EVENT_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.tagline.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.icon).toBeTruthy();
      expect(t.ticketTypes.length).toBeGreaterThan(0);
      expect(t.defaultDurationHours).toBeGreaterThan(0);
    }
  });

  it("comms blueprint offsets are well-formed (integer days)", () => {
    for (const t of EVENT_TEMPLATES) {
      for (const b of t.commsBlueprint) {
        expect(Number.isInteger(b.offsetDays)).toBe(true);
        expect(b.channels.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("findTemplate", () => {
  it("returns the matching template", () => {
    const out = findTemplate("workshop");
    expect(out?.id).toBe("workshop");
  });

  it("returns null for unknown ids (no throw)", () => {
    expect(findTemplate("does-not-exist")).toBeNull();
  });
});

describe("resolveTemplateEndDate", () => {
  it("derives endDate from start + defaultDurationHours when no override", () => {
    const out = resolveTemplateEndDate({ defaultDurationHours: 4 }, "2026-04-26T10:00:00.000Z");
    expect(out).toBe("2026-04-26T14:00:00.000Z");
  });

  it("returns the override when provided", () => {
    const out = resolveTemplateEndDate(
      { defaultDurationHours: 4 },
      "2026-04-26T10:00:00.000Z",
      "2026-04-27T15:00:00.000Z",
    );
    expect(out).toBe("2026-04-27T15:00:00.000Z");
  });
});

describe("materialiseTicketTypes", () => {
  const template = findTemplate("workshop")!;

  it("creates one TicketType per template ticket with currency XOF + soldCount=0", () => {
    const out = materialiseTicketTypes(template, "2026-04-26T10:00:00.000Z");
    expect(out).toHaveLength(template.ticketTypes.length);
    for (const t of out) {
      expect(t.currency).toBe("XOF");
      expect(t.soldCount).toBe(0);
      expect(t.isVisible).toBe(true);
    }
  });

  it("derives saleStartDate from saleOpensOffsetDays before the start", () => {
    const out = materialiseTicketTypes(template, "2026-04-26T10:00:00.000Z");
    const ticket = out[0];
    // workshop template offset is 30 days
    expect(ticket.saleStartDate).toBe("2026-03-27T10:00:00.000Z");
    // Sale closes at the event start by default.
    expect(ticket.saleEndDate).toBe("2026-04-26T10:00:00.000Z");
  });

  it("respects null totalQuantity (= unlimited)", () => {
    const tplWithUnlimited = findTemplate("kickoff-interne")!;
    const out = materialiseTicketTypes(tplWithUnlimited, "2026-04-26T10:00:00.000Z");
    expect(out[0].totalQuantity).toBeNull();
  });

  it("emits a unique id per output ticket (avoids template-id collision)", () => {
    const out = materialiseTicketTypes(findTemplate("conference")!, "2026-04-26T10:00:00.000Z");
    const ids = out.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("materialiseSessions", () => {
  const template = findTemplate("workshop")!;

  it("translates relative offsets into absolute startTime / endTime", () => {
    const out = materialiseSessions(template, "2026-04-26T10:00:00.000Z");
    expect(out).toHaveLength(template.sessions.length);
    expect(out[0].startTime).toBe("2026-04-26T10:00:00.000Z");
    // workshop session is 240 min long.
    expect(out[0].endTime).toBe("2026-04-26T14:00:00.000Z");
  });

  it("returns CreateSessionDto-shaped rows with empty speakerIds + tags", () => {
    const out = materialiseSessions(template, "2026-04-26T10:00:00.000Z");
    expect(out[0].speakerIds).toEqual([]);
    expect(out[0].tags).toEqual([]);
    expect(out[0].streamUrl).toBeNull();
    expect(out[0].isBookmarkable).toBe(true);
  });
});

describe("materialiseCommsBlueprint", () => {
  it("translates offsetDays into absolute scheduledAt", () => {
    const template = findTemplate("workshop")!;
    const out = materialiseCommsBlueprint(template, "2026-04-26T10:00:00.000Z");
    const reminder7d = out.find((b) => b.title.includes("Rappel J-7"));
    expect(reminder7d?.scheduledAt).toBe("2026-04-19T10:00:00.000Z");
  });
});
