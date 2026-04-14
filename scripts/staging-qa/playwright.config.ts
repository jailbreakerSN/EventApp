import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Teranga staging QA suite.
 *
 * URLs come from env vars so the same suite runs against staging, a PR
 * preview deploy, or a local dev server. CI defaults are the current
 * Cloud Run staging hosts.
 *
 *   STAGING_BACKOFFICE  — backoffice Next.js app
 *   STAGING_PARTICIPANT — participant Next.js app
 *   STAGING_API         — optional API base URL (only used by api-security.spec.ts)
 *
 * Defaults match the 2026-04-14 staging deploy. Override locally via:
 *   STAGING_BACKOFFICE=https://... STAGING_PARTICIPANT=https://... npx playwright test
 */

const DEFAULT_BACKOFFICE =
  process.env.STAGING_BACKOFFICE ??
  "https://teranga-backoffice-staging-784468934140.europe-west1.run.app";
const DEFAULT_PARTICIPANT =
  process.env.STAGING_PARTICIPANT ??
  "https://teranga-participant-staging-784468934140.europe-west1.run.app";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never", outputFolder: "playwright-report" }], ["github"]]
    : [["list"], ["html", { open: "on-failure" }]],

  use: {
    // Baseline for smoke tests; per-spec tests override with the correct app URL.
    baseURL: DEFAULT_PARTICIPANT,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    timezoneId: "Africa/Dakar",
  },

  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "chromium-tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone 13"] },
    },
  ],

  expect: {
    // Cloud Run cold starts can run ~6-10s on first hit; give the HTML assertions room.
    timeout: 10_000,
  },

  // Export the resolved URLs so specs can pick them up via `process.env`.
  globalSetup: "./global-setup.ts",
});
