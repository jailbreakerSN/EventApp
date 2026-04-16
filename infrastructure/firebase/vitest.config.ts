import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test file uses describe/it/beforeAll/etc. as globals — mirror the
    // other workspaces' config so the Firestore rules suite can actually
    // run. Previously it failed with "beforeAll is not defined" the
    // moment anyone invoked it outside the Firebase CI job (see PR #65
    // follow-up). CI kept passing because that job never ran either.
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
