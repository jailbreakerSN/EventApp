import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zStringBoolean } from "../utils/zod";
import { AdminOrgQuerySchema, AdminVenueQuerySchema } from "../venue.types";

// ─── zStringBoolean unit tests ──────────────────────────────────────────────
//
// Pins the failure mode that broke /admin/organizations?isVerified=false:
// `z.coerce.boolean()` calls `Boolean(v)`, and `Boolean("false") === true`,
// so the previous schema parsed `"false"` to `true` and silently inverted
// every URL filter. The replacement helper MUST round-trip "true" / "false"
// strings to their boolean counterparts.

describe("zStringBoolean", () => {
  const schema = zStringBoolean();

  it("parses 'true' as true (not the JS Boolean('true') tautology)", () => {
    expect(schema.parse("true")).toBe(true);
  });

  it("parses 'false' as false (regression for AdminOrgQuery isVerified bug)", () => {
    // The whole point of the helper. `Boolean("false") === true` was the
    // bug; here we assert the helper returns `false` instead.
    expect(schema.parse("false")).toBe(false);
  });

  it("accepts native booleans unchanged", () => {
    expect(schema.parse(true)).toBe(true);
    expect(schema.parse(false)).toBe(false);
  });

  it("accepts '1' / '0' as common URL serialisations", () => {
    expect(schema.parse("1")).toBe(true);
    expect(schema.parse("0")).toBe(false);
  });

  it("accepts 'yes' / 'no' as common URL serialisations", () => {
    expect(schema.parse("yes")).toBe(true);
    expect(schema.parse("no")).toBe(false);
  });

  it("rejects garbage values rather than silently coercing", () => {
    // Critical: a typo like ?isVerified=fals MUST surface as a validation
    // error, not silently parse to true.
    expect(() => schema.parse("fals")).toThrow();
    expect(() => schema.parse("nope")).toThrow();
    expect(() => schema.parse(2)).toThrow();
  });

  it("works inside .optional()", () => {
    const opt = z.object({ flag: zStringBoolean().optional() });
    expect(opt.parse({}).flag).toBeUndefined();
    expect(opt.parse({ flag: "false" }).flag).toBe(false);
    expect(opt.parse({ flag: "true" }).flag).toBe(true);
  });
});

// ─── End-to-end via the schemas the routes actually use ────────────────────
// Belt-and-braces — make sure the swap from `z.coerce.boolean()` to
// `zStringBoolean()` actually flowed through to AdminOrgQuerySchema /
// AdminVenueQuerySchema. A future contributor copy-pasting the old
// `z.coerce.boolean()` would re-introduce the bug; this test catches it.

describe("AdminOrgQuerySchema — isVerified URL coercion", () => {
  it("?isVerified=false is parsed as false (was true under z.coerce.boolean)", () => {
    const parsed = AdminOrgQuerySchema.parse({ isVerified: "false" });
    expect(parsed.isVerified).toBe(false);
  });

  it("?isVerified=true is parsed as true", () => {
    const parsed = AdminOrgQuerySchema.parse({ isVerified: "true" });
    expect(parsed.isVerified).toBe(true);
  });

  it("?isActive=false is parsed as false (suspended-org filter)", () => {
    const parsed = AdminOrgQuerySchema.parse({ isActive: "false" });
    expect(parsed.isActive).toBe(false);
  });
});

describe("AdminVenueQuerySchema — surfaces every status (admin moderation view)", () => {
  it("accepts status=pending so the inbox deep-link works", () => {
    const parsed = AdminVenueQuerySchema.parse({ status: "pending" });
    expect(parsed.status).toBe("pending");
  });

  it("accepts status=suspended (admin can audit moderation history)", () => {
    const parsed = AdminVenueQuerySchema.parse({ status: "suspended" });
    expect(parsed.status).toBe("suspended");
  });

  it("rejects unknown status values rather than silently dropping the filter", () => {
    expect(() => AdminVenueQuerySchema.parse({ status: "bogus" })).toThrow();
  });

  it("?isFeatured=false is parsed as false (regression — venue list filter)", () => {
    const parsed = AdminVenueQuerySchema.parse({ isFeatured: "false" });
    expect(parsed.isFeatured).toBe(false);
  });
});
