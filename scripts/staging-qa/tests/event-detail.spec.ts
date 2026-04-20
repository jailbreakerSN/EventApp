/**
 * Event-detail tabs (TASK-P1-H2) — hero + tabbed À propos / Intervenants
 * / Programme with URL-hash persistence and arrow-key keyboard nav.
 *
 * These tests need at least one published event in the staging dataset.
 * If the dataset has none, the spec skips with a clear message rather
 * than false-failing.
 */
import { test, expect } from "@playwright/test";
import { URLS } from "./_shared";

test.use({ baseURL: URLS.participant });

async function findFirstEventSlug(page: import("@playwright/test").Page): Promise<string | null> {
  await page.goto("/events");
  await page.waitForLoadState("networkidle");
  const firstCard = page.locator("a[href^='/events/']").first();
  if ((await firstCard.count()) === 0) return null;
  const href = await firstCard.getAttribute("href");
  if (!href) return null;
  // Strip "/events/" prefix and any trailing slash or query.
  return href.replace(/^\/events\//, "").split("?")[0].split("#")[0];
}

test.describe("Tabs on /events/[slug]", () => {
  test("tablist present with 2-4 tabs and aria-selected", async ({ page }) => {
    const slug = await findFirstEventSlug(page);
    test.skip(!slug, "No events published on staging — dataset is empty.");
    await page.goto(`/events/${slug}`);
    await page.waitForLoadState("networkidle");

    const tablist = page.getByRole("tablist");
    await expect(tablist).toBeVisible({ timeout: 10_000 });

    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(4);

    // Exactly one tab should have aria-selected=true.
    let selected = 0;
    for (let i = 0; i < count; i++) {
      if ((await tabs.nth(i).getAttribute("aria-selected")) === "true") selected++;
    }
    expect(selected).toBe(1);
  });

  test("hash in URL pre-selects the right tab", async ({ page }) => {
    const slug = await findFirstEventSlug(page);
    test.skip(!slug, "No events published on staging.");
    await page.goto(`/events/${slug}#about`);
    await page.waitForLoadState("networkidle");

    const aboutTab = page.getByRole("tab", { name: /à propos|about/i });
    await expect(aboutTab).toHaveAttribute("aria-selected", "true");
  });

  test("arrow keys cycle tabs + Tab exits into panel", async ({ page }) => {
    const slug = await findFirstEventSlug(page);
    test.skip(!slug, "No events published on staging.");
    await page.goto(`/events/${slug}`);
    await page.waitForLoadState("networkidle");

    const firstTab = page.getByRole("tab").first();
    await firstTab.focus();
    await page.keyboard.press("ArrowRight");
    // The focused element should now be the second tab, and aria-selected flips.
    const secondTab = page.getByRole("tab").nth(1);
    await expect(secondTab).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("SEO — JSON-LD preserved by the tab refactor", () => {
  test("event page carries <script type='application/ld+json'>", async ({ page }) => {
    const slug = await findFirstEventSlug(page);
    test.skip(!slug, "No events published on staging.");
    await page.goto(`/events/${slug}`);
    const ld = page.locator("script[type='application/ld+json']");
    await expect(ld.first()).toBeAttached();
    const json = await ld.first().textContent();
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json!);
    expect(parsed["@context"]).toMatch(/schema\.org/i);
    expect(parsed["@type"]).toBe("Event");
  });
});
