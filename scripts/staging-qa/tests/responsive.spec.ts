/**
 * Responsive sweeps — capture a screenshot of each key public route at
 * 375 / 768 / 1280 px so reviewers can spot regressions visually. Each
 * test only asserts "page loaded" — the artefact is the screenshot.
 *
 * CI uploads the `playwright-report/` folder with all screenshots on
 * every run. Diffing is out of scope for this suite (Percy /
 * Chromatic would be the next step if you need pixel-diff CI).
 */
import { test, expect } from "@playwright/test";
import { URLS } from "./_shared";

const ROUTES = [
  { name: "participant-home", base: URLS.participant, path: "/" },
  { name: "participant-events", base: URLS.participant, path: "/events" },
  { name: "backoffice-login", base: URLS.backoffice, path: "/login" },
  { name: "backoffice-forgot-password", base: URLS.backoffice, path: "/forgot-password" },
] as const;

const VIEWPORTS = [
  { label: "mobile", width: 375, height: 812 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1280, height: 800 },
] as const;

for (const route of ROUTES) {
  for (const vp of VIEWPORTS) {
    test(`${route.name} @ ${vp.label} (${vp.width}×${vp.height})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      const response = await page.goto(`${route.base}${route.path}`);
      expect(response?.ok()).toBe(true);
      await page.waitForLoadState("networkidle");

      // Attach a full-page screenshot so the HTML reporter shows it inline.
      const shot = await page.screenshot({ fullPage: true });
      await test.info().attach(`${route.name}-${vp.label}.png`, {
        body: shot,
        contentType: "image/png",
      });

      await context.close();
    });
  }
}
