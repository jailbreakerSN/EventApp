/**
 * Generate PNG logo assets from Teranga Event SVG variants.
 *
 * - Icon-only SVG  → favicons, PWA icons, apple-touch-icon, Flutter launcher
 * - Color SVG      → OG image (white bg), email logo
 * - White SVG      → OG image (dark bg — primary)
 *
 * Usage:  node scripts/generate-logo-assets.mjs
 *
 * Requires: sharp (available via Next.js dependency in the monorepo)
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// Source SVGs
const ICON_SVG_PATH = resolve(ROOT, 'packages/shared-logo/teranga_event_logo_only.svg');
const COLOR_SVG_PATH = resolve(ROOT, 'packages/shared-logo/teranga_event_color.svg');
const WHITE_SVG_PATH = resolve(ROOT, 'packages/shared-logo/teranga_event_white.svg');

// Output dirs
const WEB_OUT = resolve(ROOT, 'packages/shared-logo/generated');
const FLUTTER_OUT = resolve(ROOT, 'packages/shared-logo/generated/flutter');

// Colors
const BG_DARK = '#172721';

// Ensure output dirs exist
mkdirSync(WEB_OUT, { recursive: true });
mkdirSync(FLUTTER_OUT, { recursive: true });

// Read SVGs
const iconSvg = readFileSync(ICON_SVG_PATH, 'utf-8');
const colorSvg = readFileSync(COLOR_SVG_PATH, 'utf-8');
const whiteSvg = readFileSync(WHITE_SVG_PATH, 'utf-8');

/**
 * Prepare an SVG with explicit width/height for sharp rendering.
 */
function setSvgSize(svg, width, height) {
  return svg.replace(/<svg([^>]*)>/, `<svg$1 width="${width}" height="${height}">`);
}

/**
 * Render icon on transparent background at a given size (square).
 */
async function renderTransparent(size, outputPath) {
  const svg = setSvgSize(iconSvg, size, size);
  const iconBuf = await sharp(Buffer.from(svg))
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: iconBuf, gravity: 'centre' }])
    .png()
    .toFile(outputPath);

  console.log(`  [OK] ${outputPath} (${size}×${size}, transparent)`);
}

/**
 * Render icon on a solid background with padding.
 */
async function renderWithBackground(size, bgHex, paddingPct, outputPath) {
  const iconSize = Math.round(size * (1 - paddingPct * 2));
  const svg = setSvgSize(iconSvg, iconSize, iconSize);

  const r = parseInt(bgHex.slice(1, 3), 16);
  const g = parseInt(bgHex.slice(3, 5), 16);
  const b = parseInt(bgHex.slice(5, 7), 16);

  const iconBuf = await sharp(Buffer.from(svg))
    .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .composite([{ input: iconBuf, gravity: 'centre' }])
    .png()
    .toFile(outputPath);

  console.log(`  [OK] ${outputPath} (${size}×${size}, bg=${bgHex})`);
}

/**
 * Render OG image (1200×630) with full logo (icon + wordmark + tagline) centered.
 * @param {'dark'|'light'} theme - dark uses white SVG on dark bg, light uses color SVG on white bg
 */
async function renderOgImage(theme, outputPath) {
  const width = 1200;
  const height = 630;

  const isDark = theme === 'dark';
  const svg = isDark ? whiteSvg : colorSvg;
  const bgR = isDark ? 0x17 : 0xFF;
  const bgG = isDark ? 0x27 : 0xFF;
  const bgB = isDark ? 0x21 : 0xFF;

  // Full logo aspect ratio: 350 / 208.35 ≈ 1.68
  // Render at ~55% of width, centered
  const logoWidth = Math.round(width * 0.50);
  const logoHeight = Math.round(logoWidth / 1.68);

  const renderedSvg = setSvgSize(svg, logoWidth, logoHeight);

  const logoBuf = await sharp(Buffer.from(renderedSvg))
    .resize(logoWidth, logoHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: { width, height, channels: 4, background: { r: bgR, g: bgG, b: bgB, alpha: 1 } },
  })
    .composite([{ input: logoBuf, gravity: 'centre' }])
    .png()
    .toFile(outputPath);

  console.log(`  [OK] ${outputPath} (${width}×${height}, og-${theme})`);
}

/**
 * Render email-friendly logo PNG (color on transparent, 300px wide).
 */
async function renderEmailLogo(outputPath) {
  const logoWidth = 300;
  const logoHeight = Math.round(logoWidth / 1.68);

  const svg = setSvgSize(colorSvg, logoWidth, logoHeight);
  const logoBuf = await sharp(Buffer.from(svg))
    .resize(logoWidth, logoHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: { width: logoWidth, height: logoHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: logoBuf, gravity: 'centre' }])
    .png()
    .toFile(outputPath);

  console.log(`  [OK] ${outputPath} (${logoWidth}×${logoHeight}, email logo)`);
}

async function main() {
  console.log('Generating Teranga Event logo PNG assets...\n');
  console.log('Sources:');
  console.log('  Icon-only:', ICON_SVG_PATH);
  console.log('  Color:    ', COLOR_SVG_PATH);
  console.log('  White:    ', WHITE_SVG_PATH);
  console.log('');

  // --- Web favicons (icon-only, transparent) ---
  console.log('Web favicons (transparent):');
  await renderTransparent(16, resolve(WEB_OUT, 'favicon-16.png'));
  await renderTransparent(32, resolve(WEB_OUT, 'favicon-32.png'));
  await renderTransparent(48, resolve(WEB_OUT, 'favicon-48.png'));

  // --- Web PWA icons (icon-only, dark background with padding) ---
  console.log('\nWeb PWA icons (dark background):');
  await renderWithBackground(192, BG_DARK, 0.15, resolve(WEB_OUT, 'icon-192.png'));
  await renderWithBackground(512, BG_DARK, 0.15, resolve(WEB_OUT, 'icon-512.png'));

  // --- Apple touch icon ---
  console.log('\nApple touch icon:');
  await renderWithBackground(180, BG_DARK, 0.15, resolve(WEB_OUT, 'apple-touch-icon.png'));

  // --- OG images (full logo with wordmark + tagline) ---
  console.log('\nOG images (full logo):');
  await renderOgImage('dark', resolve(WEB_OUT, 'og-default.png'));
  await renderOgImage('light', resolve(WEB_OUT, 'og-light.png'));

  // --- Email logo (color on transparent) ---
  console.log('\nEmail logo:');
  await renderEmailLogo(resolve(WEB_OUT, 'logo-email.png'));

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
    await renderWithBackground(size, BG_DARK, 0.2, resolve(FLUTTER_OUT, `ic_launcher_${label}_${size}.png`));
  }

  console.log('\nDone! All assets generated.');
}

main().catch((err) => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
