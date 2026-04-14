/**
 * Shared helpers for the Teranga staging QA suite.
 *
 * Keep this tiny — specs read cleanly when each helper is obvious at
 * the call site. If a helper needs > 10 lines, it probably belongs
 * inline in the spec.
 */
import type { Page } from "@playwright/test";

export const URLS = {
  backoffice:
    process.env.STAGING_BACKOFFICE ??
    "https://teranga-backoffice-staging-784468934140.europe-west1.run.app",
  participant:
    process.env.STAGING_PARTICIPANT ??
    "https://teranga-participant-staging-784468934140.europe-west1.run.app",
  api: process.env.STAGING_API, // optional; enables api-security.spec.ts
} as const;

/** Cookie name used by next-intl / the cookie-based language switcher. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/**
 * Set the locale cookie for a host BEFORE the first navigation. next-intl
 * reads cookies server-side, so we have to seed the cookie on the context
 * (not the page) to make server-rendered messages match the expected locale.
 */
export async function seedLocale(
  context: Page["context"] extends (...args: unknown[]) => infer R ? R : never,
  origin: string,
  locale: "fr" | "en" | "wo",
): Promise<void> {
  const url = new URL(origin);
  await context.addCookies([
    {
      name: LOCALE_COOKIE,
      value: locale,
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

/**
 * Wait for the app's main content to paint. The dashboard layout and
 * participant layout both expose a `#main-content` anchor (H8 skip-link
 * target).
 */
export async function waitForMainContent(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  // Not all participant pages use #main-content; fall back to first <main>.
  const main = page.locator("#main-content, main").first();
  await main.waitFor({ state: "attached", timeout: 20_000 });
}
