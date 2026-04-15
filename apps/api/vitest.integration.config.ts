import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Integration test runner — boots against the Firebase Firestore emulator.
 *
 * Keep this isolated from the default `vitest` config so local runs stay
 * fast (no emulator required) and CI can provision the emulator in a
 * dedicated job. Invoke with:
 *
 *   firebase emulators:exec --only firestore \
 *     "npm run test:integration --workspace=apps/api"
 *
 * The setup file sets `FIRESTORE_EMULATOR_HOST` before any module loads,
 * so the admin SDK routes traffic to the emulator when `@/config/firebase`
 * initializes.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/integration/**/*.test.ts"],
    // Integration tests run sequentially — they share the emulator Firestore
    // state and clear it between tests. Parallel would cause cross-test
    // pollution.
    fileParallelism: false,
    sequence: { concurrent: false },
    // Emulator transactions + domain-event listeners can take longer than
    // the default 20s, especially on cold-start CI runners.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./src/__tests__/integration/setup.ts"],
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
