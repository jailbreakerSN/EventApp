/**
 * PostCSS pipeline for Storybook's preview stylesheet.
 *
 * The Vite builder picks up `postcss.config.cjs` automatically when it
 * processes `.storybook/preview.css`, resolving `@tailwind` directives
 * against `tailwind.config.ts` in the package root.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
