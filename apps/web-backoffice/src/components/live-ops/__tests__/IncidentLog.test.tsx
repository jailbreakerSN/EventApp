import { describe, it, expect } from "vitest";
import { formatElapsed } from "../helpers";

// ─── formatElapsed — relative-time helper ─────────────────────────────────
//
// The component is dominated by side-effecting UI (mutations, query
// hooks). We pin the deterministic helper here; rendering the form
// requires a QueryClientProvider + i18n + auth context which is
// rebuilt in the integration tests, not the unit tests.

describe("formatElapsed", () => {
  const now = new Date("2026-04-26T10:00:00.000Z");

  it("returns 'à l'instant' when the gap is < 1 minute", () => {
    expect(formatElapsed("2026-04-26T09:59:30.000Z", now)).toBe("à l'instant");
    expect(formatElapsed("2026-04-26T10:00:00.000Z", now)).toBe("à l'instant");
  });

  it("returns 'il y a X min' between 1 and 59 minutes", () => {
    expect(formatElapsed("2026-04-26T09:55:00.000Z", now)).toBe("il y a 5 min");
    expect(formatElapsed("2026-04-26T09:01:00.000Z", now)).toBe("il y a 59 min");
  });

  it("returns 'il y a X h' between 1 and 23 hours", () => {
    expect(formatElapsed("2026-04-26T07:00:00.000Z", now)).toBe("il y a 3 h");
    expect(formatElapsed("2026-04-25T11:00:00.000Z", now)).toBe("il y a 23 h");
  });

  it("returns 'il y a X j' once the gap is >= 24 hours", () => {
    expect(formatElapsed("2026-04-25T10:00:00.000Z", now)).toBe("il y a 1 j");
    expect(formatElapsed("2026-04-22T10:00:00.000Z", now)).toBe("il y a 4 j");
  });

  it("treats future timestamps and invalid input as 'à l'instant'", () => {
    expect(formatElapsed("2026-04-26T11:00:00.000Z", now)).toBe("à l'instant");
    expect(formatElapsed("not-a-date", now)).toBe("à l'instant");
  });
});
