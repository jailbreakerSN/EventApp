import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

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
);
