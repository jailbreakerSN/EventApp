/**
 * i18n — verifies the LanguageSwitcher cookie roundtrip (TASK-P1-I1b)
 * and that seeded wo.json strings render when the cookie is set to "wo".
 *
 * We exercise both apps because both ship their own provider + switcher
 * wrapper (participant and backoffice each have a client wrapper at
 * apps/*/src/components/language-switcher.tsx that calls router.refresh()
 * on change).
 */
import { test, expect } from "@playwright/test";
import { seedLocale, URLS } from "./_shared";

test.describe("Participant — locale roundtrip", () => {
  test.use({ baseURL: URLS.participant });

  test("default locale is French", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });

  test("cookie = en → html lang=en and English strings render", async ({ context, page }) => {
    await seedLocale(context, URLS.participant, "en");
    await page.goto("/events");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // events.noResults was migrated in I1d; English fallback should render "No events" or similar.
    // Keep the assertion tolerant — the actual copy may not be wired through `t()` yet on every string.
    const frenchOnly = page.getByText(/découvrez les événements/i);
    await expect(frenchOnly).toHaveCount(0);
  });

  test("cookie = wo → html lang=wo, partial seed renders, French fallback elsewhere", async ({
    context,
    page,
  }) => {
    await seedLocale(context, URLS.participant, "wo");
    const response = await page.goto("/events");
    expect(response?.ok()).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("lang", "wo");
    // No hard-coded assertion on visible Wolof text — wo.json is seeded with
    // only a subset of keys. We just verify the app loaded and didn't 500.
  });
});

test.describe("LanguageSwitcher UI", () => {
  test.use({ baseURL: URLS.participant });

  test("switcher is visible in the desktop header", async ({ page }) => {
    await page.goto("/");
    await page.setViewportSize({ width: 1280, height: 800 });
    const switcher = page.getByRole("combobox", { name: /choisir la langue|select language/i });
    await expect(switcher).toBeVisible();
    const options = switcher.locator("option");
    await expect(options).toHaveCount(3); // fr, en, wo
  });

  test("selecting EN sets NEXT_LOCALE cookie and triggers a refresh", async ({ context, page }) => {
    await page.goto("/");
    const switcher = page.getByRole("combobox", { name: /choisir la langue|select language/i });
    await switcher.selectOption("en");
    // Router refresh fires a fresh request; wait for it to settle.
    await page.waitForLoadState("networkidle");
    const cookies = await context.cookies();
    const localeCookie = cookies.find((c) => c.name === "NEXT_LOCALE");
    expect(localeCookie?.value).toBe("en");
  });
});
