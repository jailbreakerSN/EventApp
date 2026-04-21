import { defineConfig } from "vitest/config";

// Functions unit tests run hermetic — they mock firebase-functions v2
// wrappers (onDocumentCreated / onRequest / onSchedule / onCall) to return
// the handler directly, so tests can invoke it without a running emulator.
// For integration coverage we rely on the Firebase emulator suite in a
// separate runner (not configured yet — see 3b.1 follow-up scope).

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "lib/**"],
    testTimeout: 10_000,
    setupFiles: ["./src/__tests__/setup.ts"],
    reporters: ["default"],
  },
});
