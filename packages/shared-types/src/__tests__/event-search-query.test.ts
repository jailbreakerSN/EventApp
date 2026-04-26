import { describe, expect, it } from "vitest";
import { EventSearchQuerySchema } from "../event.types";

describe("EventSearchQuerySchema — multi-select category (P1.10)", () => {
  it("accepts a single category enum value (backward compat)", () => {
    const parsed = EventSearchQuerySchema.parse({ category: "conference" });
    expect(parsed.category).toBe("conference");
  });

  it("accepts an array of category enum values", () => {
    const parsed = EventSearchQuerySchema.parse({
      category: ["conference", "workshop"],
    });
    expect(parsed.category).toEqual(["conference", "workshop"]);
  });

  it("splits comma-separated category strings into an array", () => {
    const parsed = EventSearchQuerySchema.parse({
      category: "conference,workshop,concert",
    });
    expect(parsed.category).toEqual(["conference", "workshop", "concert"]);
  });

  it("trims whitespace around comma-separated category values", () => {
    const parsed = EventSearchQuerySchema.parse({
      category: " conference , workshop ",
    });
    expect(parsed.category).toEqual(["conference", "workshop"]);
  });

  it("drops empty entries from comma-separated input", () => {
    const parsed = EventSearchQuerySchema.parse({
      category: "conference,,workshop,",
    });
    expect(parsed.category).toEqual(["conference", "workshop"]);
  });

  it("rejects unknown category enum values inside an array", () => {
    expect(() =>
      EventSearchQuerySchema.parse({ category: ["conference", "not-a-real-category"] }),
    ).toThrow();
  });

  it("rejects unknown comma-separated category values", () => {
    expect(() =>
      EventSearchQuerySchema.parse({ category: "conference,bogus" }),
    ).toThrow();
  });

  it("rejects an empty array (Firestore `in` requires at least one value)", () => {
    expect(() => EventSearchQuerySchema.parse({ category: [] })).toThrow();
  });

  it("rejects an array of more than 30 categories (Firestore `in` cap)", () => {
    const overflow = Array.from({ length: 31 }, () => "conference");
    expect(() => EventSearchQuerySchema.parse({ category: overflow })).toThrow();
  });

  it("treats undefined category as no filter (default)", () => {
    const parsed = EventSearchQuerySchema.parse({});
    expect(parsed.category).toBeUndefined();
  });

  it("preserves the price + date filter contract while category is multi", () => {
    const parsed = EventSearchQuerySchema.parse({
      category: "conference,workshop",
      price: "free",
      dateFrom: "2026-01-01T00:00:00Z",
    });
    expect(parsed.category).toEqual(["conference", "workshop"]);
    expect(parsed.price).toBe("free");
    expect(parsed.dateFrom).toBe("2026-01-01T00:00:00Z");
  });
});
