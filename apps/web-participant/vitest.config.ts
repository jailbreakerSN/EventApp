import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// ─── Web-participant test runner (Phase D.5) ──────────────────────────────
// Mirrors the backoffice vitest setup: happy-dom + React 19 + Testing
// Library, automatic JSX, `@/` alias to `src/`. Scoped to hooks and
// components so we don't accidentally crawl into the Next.js `src/app/`
// tree (server components + server actions pull in node-only modules
// at import time).
export default defineConfig({
  plugins: [react({ jsxRuntime: "automatic" })],
  esbuild: { jsx: "automatic" },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["**/node_modules/**", "src/app/**"],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
