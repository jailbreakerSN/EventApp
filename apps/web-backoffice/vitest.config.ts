import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// ─── Web-backoffice test runner ────────────────────────────────────────────
// Free-tier friendly: no browser, no emulator. Runs component tests
// against happy-dom (lighter than jsdom) with React 19 + Testing
// Library. Alias map mirrors `tsconfig.json` so tests can import
// `@/hooks/...` the same way app code does.
export default defineConfig({
  // Explicitly request the automatic JSX runtime so tests can render TSX
  // without an `import React` boilerplate line. Matches the Next.js
  // runtime the app itself uses.
  plugins: [react({ jsxRuntime: "automatic" })],
  esbuild: { jsx: "automatic" },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Next.js app router + server actions pull in node-only modules at
    // import time. Limit the scan so we don't crawl into pages / layouts.
    exclude: ["**/node_modules/**", "src/app/**"],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
