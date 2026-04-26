/**
 * Pins Wave 10 / W10-P2 / S3 — per-route rate-limit overrides.
 *
 * The composite-key default (`apikey:*` 600/min, `user:*` 120/min,
 * `ip:*` 30/min — see ADR-0015) is intentionally lax to keep
 * integrators productive. Five abuse-prone surfaces require tighter
 * caps on top:
 *
 *   - magic-links  POST /        — issuance is email/SMS amplification
 *   - magic-links  GET  /verify  — unauth + brute-force-attractive
 *   - whatsapp     POST /opt-in  — Meta cost amplification
 *   - whatsapp     DEL  /opt-in  — symmetrical with grant
 *   - feed         all mutations — content abuse / spam
 *   - messaging    all mutations — DM spam
 *   - live-ops     POST incidents       — staff-session abuse
 *   - live-ops     POST staff-messages  — symmetrical with incidents
 *
 * This test grep-asserts each route file carries a `config:` block
 * with a `rateLimit` override. Cheap + brittle by design — if a future
 * refactor moves overrides into a plugin or a route-level decorator,
 * THIS test fails first and we add the new shape to the assertion
 * before merging. Better than silently dropping a cap.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relative: string): string {
  return readFileSync(resolve(__dirname, "..", relative), "utf8");
}

describe("Rate-limit per-route overrides — W10-P2 / S3", () => {
  it("magic-links.routes.ts caps the issuance + verify surfaces", () => {
    const src = read("magic-links.routes.ts");
    // Issuance — 5 per minute (smaller of the two).
    expect(src).toMatch(/rateLimit:\s*\{\s*max:\s*5\b/);
    // Verify — 30 per minute (larger of the two).
    expect(src).toMatch(/rateLimit:\s*\{\s*max:\s*30\b/);
  });

  it("whatsapp.routes.ts caps both opt-in mutation verbs at 10/min", () => {
    const src = read("whatsapp.routes.ts");
    const matches = src.match(/rateLimit:\s*\{\s*max:\s*10\b/g);
    // Two overrides — POST /opt-in + DELETE /opt-in.
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("feed.routes.ts wires the FEED_MUTATION_RATE_LIMIT constant on every mutation", () => {
    const src = read("feed.routes.ts");
    // Constant declared.
    expect(src).toMatch(/FEED_MUTATION_RATE_LIMIT.*30.*1 minute/);
    // Wired on enough mutating routes — at least 6 (post / patch /
    // delete post + add comment + delete comment + like / pin / upload-url).
    const refs = src.match(/rateLimit:\s*FEED_MUTATION_RATE_LIMIT/g) ?? [];
    expect(refs.length).toBeGreaterThanOrEqual(6);
  });

  it("messaging.routes.ts wires MESSAGING_MUTATION_RATE_LIMIT on every send/mutation", () => {
    const src = read("messaging.routes.ts");
    expect(src).toMatch(/MESSAGING_MUTATION_RATE_LIMIT.*30.*1 minute/);
    const refs = src.match(/rateLimit:\s*MESSAGING_MUTATION_RATE_LIMIT/g) ?? [];
    // create-conv + send-message + mark-read = 3 mutating endpoints.
    expect(refs.length).toBeGreaterThanOrEqual(3);
  });

  it("live-ops.routes.ts caps incident + staff-message creation at 30/min", () => {
    const src = read("live-ops.routes.ts");
    // The two W10-P2 overrides land at 30/min on the incident + staff-
    // message POST endpoints. They share the same posture so we count
    // distinct rateLimit blocks.
    const overrides =
      src.match(/rateLimit:\s*\{\s*max:\s*30,\s*timeWindow:\s*"1 minute"\s*\}/g) ?? [];
    expect(overrides.length).toBeGreaterThanOrEqual(2);
  });
});
