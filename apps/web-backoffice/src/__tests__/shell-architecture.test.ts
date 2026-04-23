import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Structural invariants for the shell architecture.
 *
 * These tests fail at CI time if someone ever re-nests /admin/* under
 * (dashboard)/ or lets the admin shell import the organizer shell
 * components — the two mistakes that produced the "platform-in-a-
 * platform" UX bug fixed in PR #163.
 *
 * Pure filesystem + text assertions — no Next.js / React runtime —
 * so they cost nothing to run and cannot be flaky. If Next.js ever
 * allows something like a programmatic layout inspection, these can
 * be replaced with a proper runtime check.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// apps/web-backoffice/src/__tests__/ → apps/web-backoffice/src/app/
const APP_ROOT = resolve(__dirname, "..", "app");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("shell architecture — route groups", () => {
  it("has a (dashboard) route group", () => {
    expect(existsSync(join(APP_ROOT, "(dashboard)"))).toBe(true);
  });

  it("has a (admin) route group", () => {
    expect(existsSync(join(APP_ROOT, "(admin)"))).toBe(true);
  });

  it("does NOT nest admin under (dashboard) — re-nesting reintroduces stacked shells", () => {
    const reNested = join(APP_ROOT, "(dashboard)", "admin");
    expect(
      existsSync(reNested),
      "Found /app/(dashboard)/admin/ — this nests the admin layout inside the organizer layout " +
        "and reproduces the UX bug fixed in PR #163. Move the subtree back to /app/(admin)/admin/.",
    ).toBe(false);
  });

  it("admin pages live under (admin)/admin/", () => {
    expect(existsSync(join(APP_ROOT, "(admin)", "admin", "layout.tsx"))).toBe(true);
    expect(existsSync(join(APP_ROOT, "(admin)", "admin", "inbox"))).toBe(true);
  });
});

describe("shell architecture — no cross-shell imports", () => {
  it("(admin)/admin/layout.tsx does NOT import organizer shell components", () => {
    const adminLayout = readFileSync(join(APP_ROOT, "(admin)", "admin", "layout.tsx"), "utf-8");
    // Importing any of these would stack the organizer chrome on top of
    // the admin chrome and defeat the route-group split.
    const forbidden = [
      "@/components/layouts/sidebar",
      "@/components/layouts/topbar",
      "@/components/layouts/sidebar-context",
    ];
    for (const mod of forbidden) {
      expect(adminLayout.includes(mod)).toBe(false);
    }
  });

  it("organizer pages do NOT import admin shell components", () => {
    const dashboardFiles = walk(join(APP_ROOT, "(dashboard)")).filter((p) => p.endsWith(".tsx"));
    for (const file of dashboardFiles) {
      const body = readFileSync(file, "utf-8");
      expect(
        body.includes("@/components/admin/admin-sidebar"),
        `${file} imports the admin sidebar — admin chrome must not render in the organizer shell.`,
      ).toBe(false);
    }
  });
});
