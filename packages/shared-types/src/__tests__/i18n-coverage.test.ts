import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── i18n key-coverage test ────────────────────────────────────────────────
// Walks every translation bundle in the monorepo and asserts that the
// non-French locales keep parity with the French source of truth:
//
//   1. Same leaf key paths (no missing / extra keys)
//   2. Same `{variable}` interpolation placeholders per key
//
// Teranga is francophone-first (CLAUDE.md). French is the authoritative
// locale; English and Wolof must mirror it. The test fails loudly when a
// PR adds a new fr key and forgets en / wo — the single most common i18n
// regression in the repo to date.
//
// Some bundles have an intentional partial-coverage mode (web-backoffice
// wo seed is gated behind TASK-P1-I1d per its `_meta` block). Those are
// allowed to be a strict SUBSET of fr; the test still fails if they gain
// EXTRA keys fr doesn't know about.
//
// Why one aggregate file in shared-types? This package already has a
// Vitest runner, no DOM, no Firebase mocks — the cheapest place to park
// cross-app contract tests on free-tier CI (Phase 1 of the test plan).

// vitest runs each workspace from its own CWD (packages/shared-types).
// Walk up two directories to reach the monorepo root — `packages/…` →
// `packages` → repo root. If vitest ever changes its CWD convention,
// override with `TERANGA_ROOT` env var.
const repoRoot = process.env.TERANGA_ROOT ?? resolve(process.cwd(), "..", "..");

interface Bundle {
  app: string;
  locale: "fr" | "en" | "wo";
  path: string;
  /** `partial` bundles are allowed to omit fr keys but never add new ones. */
  mode: "strict" | "partial";
}

const BUNDLES: Bundle[] = [
  // web-backoffice — JSON with `_meta` block that marks partial coverage.
  {
    app: "web-backoffice",
    locale: "fr",
    path: "apps/web-backoffice/src/i18n/messages/fr.json",
    mode: "strict",
  },
  {
    app: "web-backoffice",
    locale: "en",
    path: "apps/web-backoffice/src/i18n/messages/en.json",
    mode: "strict",
  },
  {
    app: "web-backoffice",
    locale: "wo",
    path: "apps/web-backoffice/src/i18n/messages/wo.json",
    mode: "partial", // seed bundle — TASK-P1-I1d closes the gap
  },

  // web-participant — fr / en are the primary surface; wo is translated
  // opportunistically (francophone-first per CLAUDE.md — long-tail
  // translations tracked as TASK-P1-I1d). `wo` therefore runs in
  // partial mode: fail on extra keys, tolerate missing ones.
  {
    app: "web-participant",
    locale: "fr",
    path: "apps/web-participant/src/i18n/messages/fr.json",
    mode: "strict",
  },
  {
    app: "web-participant",
    locale: "en",
    path: "apps/web-participant/src/i18n/messages/en.json",
    mode: "strict",
  },
  {
    app: "web-participant",
    locale: "wo",
    path: "apps/web-participant/src/i18n/messages/wo.json",
    mode: "partial",
  },

  // mobile — Flutter ARB files. Parsed as JSON by this Node runner;
  // `@@locale` + `@<key>` metadata entries are stripped before diff.
  // Same fr-primary / wo-partial policy as the web apps.
  {
    app: "mobile",
    locale: "fr",
    path: "apps/mobile/lib/l10n/app_fr.arb",
    mode: "strict",
  },
  {
    app: "mobile",
    locale: "en",
    path: "apps/mobile/lib/l10n/app_en.arb",
    mode: "strict",
  },
  {
    app: "mobile",
    locale: "wo",
    path: "apps/mobile/lib/l10n/app_wo.arb",
    mode: "partial",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function load(b: Bundle): Record<string, JsonValue> {
  const absolute = resolve(repoRoot, b.path);
  const raw = readFileSync(absolute, "utf-8");
  return JSON.parse(raw) as Record<string, JsonValue>;
}

/**
 * Flattens a nested JSON/ARB bundle to dot-path leaves.
 *
 * - Strips ARB metadata (`@@locale`, keys starting with `@`) since those
 *   aren't user-visible strings and shouldn't be diffed.
 * - Strips web-backoffice's `_meta` documentation block for the same
 *   reason — it's developer-facing, not end-user copy.
 * - Only string leaves count; arrays / numbers / booleans are rare in
 *   translation bundles and not worth diffing at key level.
 */
function flatten(
  obj: Record<string, JsonValue>,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    if (key === "_meta") continue;
    if (key.startsWith("@")) continue; // ARB metadata
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[path] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value as Record<string, JsonValue>, path, out);
    }
  }
  return out;
}

/**
 * Extracts `{variable}` placeholders from a translation string. Used to
 * diff interpolation contracts: if fr has `"Bonjour {name}"` but en has
 * `"Hello {user}"`, the translation will render `{user}` literally on
 * the French page — a silent UX bug. All three bundles must agree on
 * the placeholder names per key.
 */
function placeholders(text: string): string[] {
  const matches = text.match(/\{[a-zA-Z0-9_]+\}/g);
  if (!matches) return [];
  return [...new Set(matches)].sort();
}

// Group bundles per app so each locale is compared against its fr source.
const byApp: Record<string, Bundle[]> = {};
for (const b of BUNDLES) {
  (byApp[b.app] ??= []).push(b);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("i18n key coverage", () => {
  for (const [app, bundles] of Object.entries(byApp)) {
    const fr = bundles.find((b) => b.locale === "fr");
    if (!fr) throw new Error(`[${app}] missing fr bundle`);
    const otherBundles = bundles.filter((b) => b.locale !== "fr");

    describe(app, () => {
      const frFlat = flatten(load(fr));
      const frKeys = Object.keys(frFlat).sort();

      it("fr bundle is non-empty", () => {
        expect(frKeys.length).toBeGreaterThan(0);
      });

      for (const other of otherBundles) {
        const otherFlat = flatten(load(other));
        const otherKeys = Object.keys(otherFlat).sort();

        describe(`${other.locale} (${other.mode})`, () => {
          if (other.mode === "strict") {
            it("has exactly the same keys as fr", () => {
              const missing = frKeys.filter((k) => !(k in otherFlat));
              const extra = otherKeys.filter((k) => !(k in frFlat));
              expect({ missing, extra }).toEqual({ missing: [], extra: [] });
            });
          } else {
            // partial — can omit fr keys but never add new ones.
            it("has no keys that fr lacks", () => {
              const extra = otherKeys.filter((k) => !(k in frFlat));
              expect(extra).toEqual([]);
            });
          }

          it("matches fr's interpolation placeholders for every shared key", () => {
            const mismatches: Array<{ key: string; fr: string[]; other: string[] }> = [];
            for (const key of otherKeys) {
              if (!(key in frFlat)) continue; // partial bundles: skip un-shared
              const frPh = placeholders(frFlat[key]);
              const otherPh = placeholders(otherFlat[key]);
              if (JSON.stringify(frPh) !== JSON.stringify(otherPh)) {
                mismatches.push({ key, fr: frPh, other: otherPh });
              }
            }
            expect(mismatches).toEqual([]);
          });
        });
      }
    });
  }
});
