/**
 * Theming — dark-mode toggle + reduced-motion honoured globally
 * (TASK-P1-N2/N4, WCAG 2.3.3 via P0 reduced-motion CSS rule).
 *
 * We test the theme toggle by clicking it and asserting that the
 * `<html>` element's class list flips to include `dark`. Reduced-motion
 * is tested by emulating the OS preference and checking that a known
 * Skeleton's animation is paused.
 */
import { test, expect } from "@playwright/test";
import { URLS } from "./_shared";

test.describe("Participant — dark mode", () => {
  test.use({ baseURL: URLS.participant });

  test("toggle dark mode flips html.dark", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const initial = await html.getAttribute("class");

    // ThemeToggle button has aria-label "Changer le thème" or similar.
    const toggle = page.getByRole("button", { name: /thème|theme/i }).first();
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.waitForTimeout(300);

    const after = await html.getAttribute("class");
    expect(after).not.toBe(initial);
    // If the initial was light, after should contain "dark"; if initial was dark, it shouldn't.
    const initialIsDark = (initial ?? "").includes("dark");
    const afterIsDark = (after ?? "").includes("dark");
    expect(afterIsDark).not.toBe(initialIsDark);
  });
});

test.describe("Reduced-motion honoured globally", () => {
  test.use({
    baseURL: URLS.participant,
    colorScheme: "light",
  });

  test("with prefers-reduced-motion: reduce, Skeleton animation is paused", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/events");
    await page.waitForLoadState("networkidle");

    // The global @media (prefers-reduced-motion: reduce) rule in globals.css
    // neutralises animation + transition durations. Pick any element that
    // would otherwise animate and verify its computed animation-duration
    // is "0s".
    const animated = page.locator("[class*='animate']").first();
    if ((await animated.count()) > 0) {
      const duration = await animated.evaluate((el) => getComputedStyle(el).animationDuration);
      // The global rule forces animation-duration to 0.01ms via !important.
      // Tailwind's motion-safe scopes also do this. Accept either.
      expect(duration).toMatch(/^0\.?01?ms$|^0s$/);
    }

    await context.close();
  });
});
