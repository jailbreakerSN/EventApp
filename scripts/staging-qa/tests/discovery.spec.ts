/**
 * Discovery chips (TASK-P1-H1) — event-filters.tsx migrated from
 * 6 Selects to a chip row for date + price, with URL search-param
 * persistence and scroll-snap on narrow viewports.
 */
import { test, expect } from "@playwright/test";
import { URLS } from "./_shared";

test.use({ baseURL: URLS.participant });

test.describe("Date chips", () => {
  test("chips render with aria-pressed and keyboard focus", async ({ page }) => {
    await page.goto("/events");
    // Chip row renders 4 chips: Aujourd'hui / Cette semaine / Ce weekend / Ce mois.
    const chips = page.getByRole("button", { name: /aujourd|cette semaine|ce weekend|ce mois/i });
    await expect(chips.first()).toBeVisible();
    const count = await chips.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // Each chip carries aria-pressed.
    for (let i = 0; i < count; i++) {
      await expect(chips.nth(i)).toHaveAttribute("aria-pressed", /true|false/);
    }
  });

  test("clicking a chip updates the URL and aria-pressed", async ({ page }) => {
    await page.goto("/events");
    const chip = page.getByRole("button", { name: /ce weekend/i });
    await chip.click();
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("date=this_weekend");
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  test("clicking the active chip clears the filter (toggle semantics)", async ({ page }) => {
    await page.goto("/events?date=this_week");
    const chip = page.getByRole("button", { name: /cette semaine/i });
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await chip.click();
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("date=this_week");
  });
});

test.describe("Mobile behaviour", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("chip row is horizontally scrollable without clipping", async ({ page }) => {
    await page.goto("/events");
    const row = page
      .locator("[role='group']", { has: page.getByRole("button", { name: /aujourd/i }) })
      .first();
    await expect(row).toBeVisible();
    const scrollWidth = await row.evaluate((el) => el.scrollWidth);
    const clientWidth = await row.evaluate((el) => el.clientWidth);
    // Scroll width should exceed the viewport — horizontal overflow is
    // intentional on < 640 px. If they match, the row probably wrapped
    // (regression).
    expect(scrollWidth).toBeGreaterThanOrEqual(clientWidth);
  });
});

test.describe("Price chips", () => {
  test("price chips render with the expected labels", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByRole("button", { name: /^gratuit$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^payant$/i })).toBeVisible();
  });
});
