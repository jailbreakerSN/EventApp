/**
 * Accessibility — runs axe-core against each public route and fails on
 * any serious / critical issue. Moderate / minor issues are surfaced
 * as test annotations so reviewers can triage without blocking the
 * build.
 *
 * Scope: public routes only. Authenticated surfaces (dashboard,
 * verify-email, organiser flows) would require seeded accounts +
 * Firebase custom tokens — run those once the staging auth fixtures
 * are wired up (see staging-playwright-runbook.md §Fixtures).
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { URLS } from "./_shared";

const PUBLIC_ROUTES = [
  { name: "participant-home", base: URLS.participant, path: "/" },
  { name: "participant-events", base: URLS.participant, path: "/events" },
  { name: "participant-login", base: URLS.participant, path: "/login" },
  { name: "participant-register", base: URLS.participant, path: "/register" },
  { name: "backoffice-login", base: URLS.backoffice, path: "/login" },
  { name: "backoffice-forgot-password", base: URLS.backoffice, path: "/forgot-password" },
] as const;

for (const route of PUBLIC_ROUTES) {
  test(`axe — ${route.name}`, async ({ page }) => {
    await page.goto(`${route.base}${route.path}`);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // Exclude the Toaster region — Sonner renders it inside a portal
      // whose role="region" survives axe's own region check. False positive.
      .exclude("[data-sonner-toaster]")
      .analyze();

    // Surface moderate issues as annotations; fail only on serious+critical.
    const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""));
    const moderate = results.violations.filter((v) => v.impact === "moderate");

    for (const m of moderate) {
      test.info().annotations.push({
        type: "a11y-moderate",
        description: `${m.id} — ${m.description} (${m.nodes.length} node${m.nodes.length > 1 ? "s" : ""})`,
      });
    }

    if (serious.length > 0) {
      const report = serious
        .map(
          (v) =>
            `• ${v.id} (${v.impact}): ${v.help}\n  ${v.helpUrl}\n  ${v.nodes.length} node(s) affected.`,
        )
        .join("\n\n");
      await test.info().attach(`axe-${route.name}.json`, {
        body: Buffer.from(JSON.stringify(results, null, 2)),
        contentType: "application/json",
      });
      expect.soft(serious, `Serious a11y violations on ${route.path}:\n\n${report}`).toEqual([]);
    }
  });
}
