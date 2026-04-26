import { describe, expect, it } from "vitest";
import { buildSearchKeywords, normalizeFr, tokenizeFr } from "../utils/normalize";

describe("normalizeFr", () => {
  it("strips diacritics on common French words", () => {
    expect(normalizeFr("Sénégal")).toBe("senegal");
    expect(normalizeFr("Café")).toBe("cafe");
    expect(normalizeFr("Thiès")).toBe("thies");
    expect(normalizeFr("CÔTE-D'IVOIRE")).toBe("cote-d'ivoire");
  });

  it("lowercases ASCII", () => {
    expect(normalizeFr("DAKAR")).toBe("dakar");
    expect(normalizeFr("MixedCase")).toBe("mixedcase");
  });

  it("unifies smart quotes to ASCII apostrophe", () => {
    expect(normalizeFr("L'Atelier")).toBe("l'atelier");
    expect(normalizeFr("L'Atelier")).toBe("l'atelier");
    expect(normalizeFr("LʼAtelier")).toBe("l'atelier");
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeFr("  Café   Bar  ")).toBe("cafe bar");
    expect(normalizeFr("a\tb\nc")).toBe("a b c");
  });

  it("returns empty string on empty input", () => {
    expect(normalizeFr("")).toBe("");
    expect(normalizeFr("   ")).toBe("");
  });
});

describe("tokenizeFr", () => {
  it("splits on non-letter / non-digit characters", () => {
    expect(tokenizeFr("Dakar Tech Summit 2026")).toEqual(["dakar", "tech", "summit", "2026"]);
  });

  it("strips diacritics in tokens", () => {
    expect(tokenizeFr("Conférence à Thiès")).toEqual(["conference", "thies"]);
  });

  it("drops tokens shorter than 2 characters", () => {
    expect(tokenizeFr("a b cd e fg")).toEqual(["cd", "fg"]);
  });

  it("treats apostrophes as token separators", () => {
    expect(tokenizeFr("L'Atelier")).toEqual(["atelier"]);
  });
});

describe("buildSearchKeywords", () => {
  it("emits every 2..min(15,len) prefix per token", () => {
    const keywords = buildSearchKeywords([{ weight: 3, text: "Dakar" }]);
    expect(keywords).toEqual(expect.arrayContaining(["da", "dak", "daka", "dakar"]));
    expect(keywords).not.toContain("d");
  });

  it("deduplicates across overlapping inputs", () => {
    const keywords = buildSearchKeywords([
      { weight: 3, text: "Dakar" },
      { weight: 1, text: "dakar" },
    ]);
    expect(keywords.filter((k) => k === "dakar")).toHaveLength(1);
  });

  it("normalises diacritics so 'Sénégal' indexes the same as 'senegal'", () => {
    const a = buildSearchKeywords([{ weight: 3, text: "Sénégal" }]);
    const b = buildSearchKeywords([{ weight: 3, text: "Senegal" }]);
    expect(a.sort()).toEqual(b.sort());
  });

  it("caps at 200 keywords and prefers high-weight parts", () => {
    const longHigh = "a".repeat(15) + " " + "b".repeat(15) + " " + "c".repeat(15);
    const padding = Array.from({ length: 50 }, (_, i) => `pad${String(i).padStart(3, "0")}`).join(" ");
    const keywords = buildSearchKeywords([
      { weight: 3, text: longHigh },
      { weight: 1, text: padding },
    ]);
    expect(keywords.length).toBeLessThanOrEqual(200);
    // High-weight tokens are processed first, so prefixes of "aaaa…" must be present.
    expect(keywords).toContain("aa");
  });

  it("ignores nullish / empty text parts", () => {
    expect(buildSearchKeywords([{ weight: 3, text: undefined }])).toEqual([]);
    expect(buildSearchKeywords([{ weight: 3, text: null }])).toEqual([]);
    expect(buildSearchKeywords([{ weight: 3, text: "" }])).toEqual([]);
  });

  it("handles tags array idiomatically when callers join with space", () => {
    const tags = ["tech", "startup", "fintech"];
    const keywords = buildSearchKeywords([{ weight: 2, text: tags.join(" ") }]);
    expect(keywords).toEqual(expect.arrayContaining(["te", "tec", "tech", "st", "fi", "fin"]));
  });
});
