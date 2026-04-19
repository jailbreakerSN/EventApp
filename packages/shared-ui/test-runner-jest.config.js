/* eslint-disable @typescript-eslint/no-require-imports */
// Custom Jest config consumed by @storybook/test-runner.
//
// Picked up automatically by the `test-runner-jest*` glob that
// `test-storybook` runs in the cwd (here: packages/shared-ui). Without
// this file, the test-runner falls back to its packaged config which
// hard-codes `jest-playwright`'s default `launchType: "SERVER"` and
// ignores our jest-playwright.config.js.
//
// The SERVER launch type makes jest-playwright call
// `browserType.launchServer()`, which requires the
// `chromium-headless-shell` binary bundled with Playwright. In some
// environments (sandboxed CI containers, dev boxes with a pre-cached
// Chromium but no headless-shell), that binary isn't available. By
// forcing `launchType: "LAUNCH"` we use the regular Chromium
// executablePath, which is what the CI workflow installs with
// `playwright install chromium`.

const path = require("node:path");

const { getJestConfig } = require("@storybook/test-runner");

const baseConfig = getJestConfig();

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  ...baseConfig,
  // Pin rootDir to this workspace so snapshot paths, transform patterns,
  // and haste-map scope stay contained. Without this, the test-runner's
  // default `getProjectRoot()` walks up to the git top-level, which in
  // a worktree-based layout picks up every sibling worktree's
  // node_modules and trips the Jest haste-map on duplicate
  // `@teranga/*` package names.
  rootDir: __dirname,
  testEnvironmentOptions: {
    ...baseConfig.testEnvironmentOptions,
    "jest-playwright": {
      ...(baseConfig.testEnvironmentOptions?.["jest-playwright"] ?? {}),
      launchType: "LAUNCH",
      browsers: ["chromium"],
      launchOptions: {
        headless: true,
        ...(executablePath ? { executablePath } : {}),
      },
      contextOptions: {
        viewport: { width: 1280, height: 720 },
        // Pin locale + timezone so date/number formatting in stories
        // (XOF currency, French month names) matches the committed
        // baselines regardless of the host machine's locale.
        locale: "fr-FR",
        timezoneId: "Africa/Dakar",
      },
    },
  },
  // Only execute the test-runner's generated specs (derived from
  // storybook's index.json). This keeps Jest from accidentally picking
  // up unrelated `.test.ts` files under apps/* that share the monorepo
  // root dir.
  testMatch: baseConfig.testMatch,
};
