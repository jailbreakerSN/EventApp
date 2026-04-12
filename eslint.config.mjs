// TODO: Add eslint-plugin-jsx-a11y for accessibility linting of JSX elements.
// Install: npm install -D eslint-plugin-jsx-a11y
// Then add jsxA11y.flatConfigs.recommended to the config array below.
// See: https://github.com/jsx-eslint/eslint-plugin-jsx-a11y
import js from "@eslint/js";
import tseslint from "typescript-eslint";

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
);
