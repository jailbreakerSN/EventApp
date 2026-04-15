import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    // Integration tests live under src/__tests__/integration/ and require a
    // running Firestore emulator. They have their own runner
    // (`npm run test:integration`, via vitest.integration.config.ts) and are
    // excluded here so `npm test` stays fast and hermetic for contributors
    // who don't have the emulator.
    exclude: ["**/node_modules/**", "src/__tests__/integration/**"],
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/__tests__/**",
        "src/**/index.ts", // barrel re-exports
      ],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50,
      },
    },
    setupFiles: ["./src/__tests__/setup.ts"],
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
