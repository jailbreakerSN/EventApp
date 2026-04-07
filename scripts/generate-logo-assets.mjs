/**
 * Generate PNG logo assets from the Teranga Event icon-only SVG.
 *
 * Usage:  node scripts/generate-logo-assets.mjs
 *
 * Requires: sharp (available via Next.js dependency in the monorepo)
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// Paths
const ICON_SVG_PATH = resolve(ROOT, 'packages/shared-logo/teranga_event_logo_only.svg');
const WEB_OUT = resolve(ROOT, 'packages/shared-logo/generated');
const FLUTTER_OUT = resolve(ROOT, 'packages/shared-logo/generated/flutter');

// Colors
const BG_DARK = '#172721';
const ICON_COLOR = '#c59e4b';

// Ensure output dirs exist
mkdirSync(WEB_OUT, { recursive: true });
mkdirSync(FLUTTER_OUT, { recursive: true });

// Read the raw SVG
const rawSvg = readFileSync(ICON_SVG_PATH, 'utf-8');

// The viewBox is 0 0 134.6153846153846 128.8074247814646
// Aspect ratio: width/height = 134.615 / 128.807 ~ 1.045 (nearly square, slightly wider)
const VB_W = 134.6153846153846;
const VB_H = 128.8074247814646;

/**
 * Prepare the SVG with explicit width/height for sharp to render at a given size.
 * We set the SVG to render the icon centered on a square canvas of `size` pixels.
 */
function buildIconSvg(size) {
  // Determine the icon render size within the square
  const iconSize = size; // Fill the square, sharp will handle aspect ratio via viewBox
  return rawSvg
    .replace(/<svg([^>]*)>/, `<svg$1 width="${iconSize}" height="${iconSize}">`);
}

/**
 * Render icon on transparent background at a given size (square).
 */
async function renderTransparent(size, outputPath) {
  const svg = buildIconSvg(size);
  const iconBuf = await sharp(Buffer.from(svg))
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: iconBuf, gravity: 'centre' }])
    .png()
    .toFile(outputPath);

  console.log(`  [OK] ${outputPath} (${size}x${size}, transparent)`);
}

/**
 * Render icon on a solid background with padding.
 * @param {number} size - Output image size (square)
 * @param {string} bgHex - Background hex color
 * @param {number} paddingPct - Padding as fraction (e.g. 0.2 = 20%)
 * @param {string} outputPath
 */
async function renderWithBackground(size, bgHex, paddingPct, outputPath) {
  const iconSize = Math.round(size * (1 - paddingPct * 2));
  const svg = buildIconSvg(iconSize);

  // Parse bg color
  const r = parseInt(bgHex.slice(1, 3), 16);
  const g = parseInt(bgHex.slice(3, 5), 16);
  const b = parseInt(bgHex.slice(5, 7), 16);

  const iconBuf = await sharp(Buffer.from(svg))
    .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .composite([{ input: iconBuf, gravity: 'centre' }])
    .png()
    .toFile(outputPath);

  console.log(`  [OK] ${outputPath} (${size}x${size}, bg=${bgHex})`);
}

/**
 * Render OG image (1200x630) with icon centered on dark background.
 */
async function renderOgImage(outputPath) {
  const width = 1200;
  const height = 630;
  // Icon should be ~40% of the shorter dimension
  const iconSize = Math.round(height * 0.4);
  const svg = buildIconSvg(iconSize);

  const r = parseInt(BG_DARK.slice(1, 3), 16);
  const g = parseInt(BG_DARK.slice(3, 5), 16);
  const b = parseInt(BG_DARK.slice(5, 7), 16);

  const iconBuf = await sharp(Buffer.from(svg))
    .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .composite([{ input: iconBuf, gravity: 'centre' }])
    .png()
    .toFile(outputPath);

  console.log(`  [OK] ${outputPath} (${width}x${height}, og-default)`);
}

async function main() {
  console.log('Generating Teranga Event logo PNG assets...\n');
  console.log('Source SVG:', ICON_SVG_PATH);
  console.log('');

  // --- Web favicons (transparent) ---
  console.log('Web favicons (transparent):');
  await renderTransparent(16, resolve(WEB_OUT, 'favicon-16.png'));
  await renderTransparent(32, resolve(WEB_OUT, 'favicon-32.png'));
  await renderTransparent(48, resolve(WEB_OUT, 'favicon-48.png'));

  // --- Web PWA icons (dark background with padding) ---
  console.log('\nWeb PWA icons (dark background):');
  await renderWithBackground(192, BG_DARK, 0.15, resolve(WEB_OUT, 'icon-192.png'));
  await renderWithBackground(512, BG_DARK, 0.15, resolve(WEB_OUT, 'icon-512.png'));

  // --- Apple touch icon ---
  console.log('\nApple touch icon:');
  await renderWithBackground(180, BG_DARK, 0.15, resolve(WEB_OUT, 'apple-touch-icon.png'));

  // --- OG image ---
  console.log('\nOG default image:');
  await renderOgImage(resolve(WEB_OUT, 'og-default.png'));

  // --- Flutter launcher icons ---
  console.log('\nFlutter launcher icons:');
  const flutterSizes = [
    { size: 48, label: 'mdpi' },
    { size: 72, label: 'hdpi' },
    { size: 96, label: 'xhdpi' },
    { size: 144, label: 'xxhdpi' },
    { size: 192, label: 'xxxhdpi' },
  ];
  for (const { size, label } of flutterSizes) {
    await renderWithBackground(
      size,
      BG_DARK,
      0.2,
      resolve(FLUTTER_OUT, `ic_launcher_${label}_${size}.png`)
    );
  }

  console.log('\nDone! All assets generated.');
}

main().catch((err) => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
