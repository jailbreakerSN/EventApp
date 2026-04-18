/* eslint-disable @typescript-eslint/no-require-imports */
// Jest-playwright configuration consumed by @storybook/test-runner via
// jest-playwright-preset. Loaded when process.env.JEST_PLAYWRIGHT_CONFIG
// is set to the absolute path of this file.
//
// Why we need a config file at all:
// -----------------------------------------------------------------
// The test-runner's bundled transitive deps pin an older-ish playwright
// that may not match the Chromium revision cached in the current
// environment. Setting PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (or the
// PLAYWRIGHT_BROWSERS_PATH envvar) is not sufficient when the cache
// predates the installed playwright's expected revision — playwright
// will refuse to launch and prompt a `playwright install`.
//
// On CI (see .github/workflows/shared-ui-quality.yml) we explicitly run
// `playwright install chromium` so the bundled revision is always
// available, and this config then falls back to Playwright's automatic
// discovery (no explicit executablePath). Locally, sandboxed
// environments can set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to point at a
// pre-installed Chromium; when set we forward it.

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

/** @type {import('jest-playwright-preset').JestPlaywrightConfig} */
module.exports = {
  browsers: ["chromium"],
  // "LAUNCH" avoids jest-playwright's default "SERVER" launchType, which
  // invokes `browserType.launchServer()` — that code path requires the
  // chromium-headless-shell binary even when the caller provides a full
  // Chromium executable. "LAUNCH" uses `browserType.launch()` directly,
  // so the executablePath below is honoured and no headless-shell is
  // needed.
  launchType: "LAUNCH",
  launchOptions: {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  },
  contextOptions: {
    viewport: { width: 1280, height: 720 },
    // Force a consistent locale so date/number/string formatting in
    // stories (XOF currency, French month names) always matches the
    // committed baselines regardless of the host locale.
    locale: "fr-FR",
    timezoneId: "Africa/Dakar",
  },
};
