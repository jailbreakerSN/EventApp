import { describe, it, expect } from "vitest";
import { findDuplicateCandidates, mergeTagLists } from "../participant-merge.service";
import { buildDuplicatePairId, normaliseEmail, normalisePhone } from "@teranga/shared-types";

// ─── Pure helpers — duplicate detection geometry + tag merge ──────────────
//
// The Firestore-bound merge logic uses a transaction we don't unit-
// test directly (covered in integration tests of the merge route).
// Here we pin the pure helpers + the candidate detection algorithm
// — those are the load-bearing pieces of the dedup MVP.

describe("normaliseEmail", () => {
  it("lowercases and trims the input", () => {
    expect(normaliseEmail("  Alice@Example.COM  ")).toBe("alice@example.com");
  });

  it("strips the gmail +suffix alias on @gmail.com", () => {
    expect(normaliseEmail("alice+sponsor@gmail.com")).toBe("alice@gmail.com");
  });

  it("strips the gmail +suffix alias on @googlemail.com (legacy domain)", () => {
    expect(normaliseEmail("alice+x@googlemail.com")).toBe("alice@googlemail.com");
  });

  it("removes the gmail dot trick", () => {
    expect(normaliseEmail("a.l.i.c.e@gmail.com")).toBe("alice@gmail.com");
  });

  it("keeps the +suffix on non-gmail domains (the convention is non-universal)", () => {
    expect(normaliseEmail("alice+sponsor@teranga.events")).toBe("alice+sponsor@teranga.events");
  });

  it("returns the trimmed input when no @ is present (defensive)", () => {
    expect(normaliseEmail("not-an-email")).toBe("not-an-email");
  });
});

describe("normalisePhone", () => {
  it("strips every non-digit character", () => {
    expect(normalisePhone("+221 70 000 00 00")).toBe("221700000000");
  });

  it("returns the empty string when the input has no digits", () => {
    expect(normalisePhone("---")).toBe("");
  });
});

describe("buildDuplicatePairId", () => {
  it("is symmetric — (a, b) and (b, a) yield the same id", () => {
    expect(buildDuplicatePairId("u-2", "u-1")).toBe(buildDuplicatePairId("u-1", "u-2"));
  });

  it("uses the lexicographically smaller id first", () => {
    expect(buildDuplicatePairId("u-z", "u-a")).toBe("u-a__u-z");
  });
});

describe("findDuplicateCandidates", () => {
  it("returns an empty list when no duplicates exist", () => {
    const out = findDuplicateCandidates(
      [
        { id: "a", email: "alice@example.com", phone: null },
        { id: "b", email: "bob@example.com", phone: null },
      ],
      100,
    );
    expect(out).toEqual([]);
  });

  it("emits one candidate when two users share an email", () => {
    const out = findDuplicateCandidates(
      [
        { id: "a", email: "alice@gmail.com", phone: null },
        { id: "b", email: "ALICE@gmail.com", phone: null },
      ],
      100,
    );
    expect(out).toHaveLength(1);
    expect(out[0].matchKind).toBe("email");
    expect(out[0].matchValue).toBe("alice@gmail.com");
    expect(out[0].pairId).toBe("a__b");
  });

  it("emits one candidate when two users share a phone (after normalisation)", () => {
    const out = findDuplicateCandidates(
      [
        { id: "a", email: null, phone: "+221 70 000 00 00" },
        { id: "b", email: null, phone: "221700000000" },
      ],
      100,
    );
    expect(out).toHaveLength(1);
    expect(out[0].matchKind).toBe("phone");
  });

  it("dedupes the pair when both email AND phone match the same way (single candidate)", () => {
    const out = findDuplicateCandidates(
      [
        { id: "a", email: "alice@example.com", phone: "+221700000000" },
        { id: "b", email: "alice@example.com", phone: "+221700000000" },
      ],
      100,
    );
    expect(out).toHaveLength(1);
    // First match wins on the deterministic pair id; we don't assert
    // matchKind here because both email and phone would qualify.
  });

  it("respects the limit cap even when more pairs would qualify", () => {
    const users = Array.from({ length: 6 }, (_, i) => ({
      id: `u-${i}`,
      email: "shared@example.com",
      phone: null,
    }));
    // 6 users sharing the same email → 6 choose 2 = 15 pairs.
    const out = findDuplicateCandidates(users, 5);
    expect(out).toHaveLength(5);
  });

  it("ignores phone matches shorter than 6 digits (avoids junk landlines)", () => {
    const out = findDuplicateCandidates(
      [
        { id: "a", email: null, phone: "12345" },
        { id: "b", email: null, phone: "12345" },
      ],
      100,
    );
    expect(out).toEqual([]);
  });
});

describe("mergeTagLists", () => {
  it("unions two tag lists, dedupes, sorts FR-locale", () => {
    expect(mergeTagLists(["VIP"], ["Press", "VIP"])).toEqual(["Press", "VIP"]);
  });

  it("returns an empty array when both inputs are empty", () => {
    expect(mergeTagLists([], [])).toEqual([]);
  });

  it("trims whitespace and drops empties", () => {
    expect(mergeTagLists(["VIP "], ["  ", "Press"])).toEqual(["Press", "VIP"]);
  });
});
