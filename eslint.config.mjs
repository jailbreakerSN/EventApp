import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import { createRequire } from "node:module";

// Project-local custom rules live in apps/api/eslint-rules. Flat config
// has no `rulePaths`, so we wrap each rule as an inline plugin keyed
// under the `teranga/` namespace. See apps/api/eslint-rules/README.md.
const require = createRequire(import.meta.url);
const noDirectEmailService = require("./apps/api/eslint-rules/no-direct-email-service.js");

// Downgrade all jsx-a11y recommended rules from "error" to "warn" so
// existing code is not broken while we progressively fix violations.
const a11yRecommendedRules = Object.fromEntries(
  Object.entries(jsxA11y.flatConfigs.recommended.rules).map(([rule, value]) => {
    if (value === "off" || (Array.isArray(value) && value[0] === "off")) {
      return [rule, value]; // keep "off" rules as-is
    }
    // Downgrade to "warn", preserving options if present
    if (Array.isArray(value)) {
      return [rule, ["warn", ...value.slice(1)]];
    }
    return [rule, "warn"];
  }),
);

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/lib/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/build/**",
      "apps/mobile/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // jsx-a11y: accessibility linting for JSX elements (tsx files only)
  {
    files: ["**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      ...a11yRecommendedRules,
    },
  },
  // teranga/no-direct-email-service — API-scoped custom rule that flags
  // direct `emailService.sendXxx()` calls. See apps/api/eslint-rules/
  // README.md. Severity is `warn` during the Phase 2.2 flag-gated
  // rollout; flip to `error` after Phase 2.3 soak in staging.
  {
    files: ["apps/api/src/**/*.ts"],
    plugins: {
      teranga: {
        rules: {
          "no-direct-email-service": noDirectEmailService,
        },
      },
    },
    rules: {
      "teranga/no-direct-email-service": [
        "warn",
        {
          allowedFiles: [
            // emailService internals — the sendXxx shims that branch on
            // isDispatcherEnabled are the transition mechanism and stay
            // until Phase 2.3 deletes them.
            "apps/api/src/services/email.service.ts",
            // The dispatcher itself — it never calls emailService
            // directly, but we allow-list it for symmetry.
            "apps/api/src/services/notification-dispatcher.service.ts",
            // The email channel adapter registered with the dispatcher.
            // By definition it calls into emailService.sendToUser /
            // sendDirect — that's the whole point of the adapter.
            "apps/api/src/services/email/dispatcher-adapter.ts",
          ],
        },
      ],
    },
  },
);
