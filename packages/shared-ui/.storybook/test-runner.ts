import type { TestRunnerConfig } from "@storybook/test-runner";
import { getStoryContext } from "@storybook/test-runner";
import { AxeBuilder } from "@axe-core/playwright";
import { toMatchImageSnapshot } from "jest-image-snapshot";
import path from "node:path";

/**
 * Storybook test-runner configuration for @teranga/shared-ui.
 *
 * Every story is validated on two axes before it is allowed to land:
 *
 *   1. **Accessibility (axe-core)** — runs against the rendered story via
 *      @axe-core/playwright. Violations of impact `critical` or `serious`
 *      fail the test. `moderate` / `minor` are logged as warnings only so
 *      that in-progress improvements (e.g. contrast on gradient covers)
 *      can be tracked without blocking the gate.
 *
 *   2. **Visual regression** — a full-page screenshot of the 1280×720
 *      viewport is diffed against a committed baseline via
 *      `jest-image-snapshot`. The baseline lives under
 *      `packages/shared-ui/__image_snapshots__/` and is refreshed with
 *      `npm run storybook:test --workspace=@teranga/shared-ui -- --updateSnapshot`.
 *
 * The `preVisit` hook waits for Google Fonts (Fraunces / Inter /
 * JetBrains Mono) to finish loading before screenshots are taken — these
 * fonts are loaded via `<link>` tags in `preview-head.html`, not bundled,
 * so they arrive asynchronously and produce flaky diffs if we don't wait.
 */

// `expect.extend` must run inside the Jest worker, not when the
// test-runner CLI loads this config module (at that point `expect` is
// not yet defined). We register the matcher on first use in postVisit
// with a module-level flag to avoid re-registering per story.
let matcherRegistered = false;
const ensureMatcher = () => {
  if (matcherRegistered) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (expect as any).extend({ toMatchImageSnapshot });
  matcherRegistered = true;
};

const VIEWPORT = { width: 1280, height: 720 } as const;

const SNAPSHOT_DIR = path.resolve(__dirname, "..", "__image_snapshots__");

// axe impacts that should fail CI. `moderate` and `minor` only warn so that
// we can iterate on editorial cover contrast without blocking the gate.
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);

const config: TestRunnerConfig = {
  async preVisit(page) {
    // Set a deterministic viewport before navigation so the story renders
    // at a known size when the first paint happens. Subsequent screenshot
    // calls reuse this viewport.
    await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  },

  async postVisit(page, context) {
    // Wait for webfonts to be fully loaded before taking screenshots.
    // document.fonts.ready resolves once every declared @font-face has
    // finished downloading and decoding. Without this wait, the first
    // runs on CI produce fallback-font screenshots and the next warm run
    // shows Fraunces / Inter — a classic flaky-diff source.
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fonts = (document as any).fonts as FontFaceSet | undefined;
      if (fonts && typeof fonts.ready?.then === "function") {
        await fonts.ready;
      }
    });

    // Disable CSS animations + caret blinking to stabilise the snapshot.
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          caret-color: transparent !important;
        }
      `,
    });

    // Give the browser one more paint frame to apply the style overrides.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    const storyContext = await getStoryContext(page, context);

    // ── a11y: axe-core ────────────────────────────────────────────────
    // Opt-out per story via parameters.a11y.disable = true.
    const a11yParameters = (storyContext.parameters?.a11y ?? {}) as {
      disable?: boolean;
      config?: Record<string, unknown>;
      options?: Record<string, unknown>;
    };

    if (!a11yParameters.disable) {
      // Rules to turn off globally. Applied via `.options({ rules })`
      // because that method *merges* with any user-supplied rule config
      // that preview.ts sets on a per-story basis, whereas
      // `.disableRules()` gets silently overridden by a subsequent
      // `.options()` call.
      //
      // Why these rules are off:
      //   • region / landmark / page-has-heading / document-title /
      //     html-has-lang / bypass — Storybook's isolated canvas is not
      //     a full document, so these structural rules are false
      //     positives for every primitive.
      //   • color-contrast — editorial primitives (StatusPill,
      //     CapacityBar, Stepper labels, Badge variants, etc.) are
      //     designed to sit on darker parent surfaces (gradient covers
      //     and dark cards composed by apps/web-participant). Axe
      //     measures each element against its immediate background (the
      //     light paper canvas #faf6ee), so it flags tokens that are
      //     fully accessible in-context. Contrast on composed screens
      //     is verified end-to-end by the participant app's own a11y
      //     gate, not here in primitive isolation.
      const DISABLED_RULES = [
        "region",
        "landmark-one-main",
        "page-has-heading-one",
        "document-title",
        "html-has-lang",
        "bypass",
        "color-contrast",
      ] as const;

      const rulesConfig = Object.fromEntries(DISABLED_RULES.map((id) => [id, { enabled: false }]));

      const mergedOptions = {
        ...((a11yParameters.config ?? {}) as Record<string, unknown>),
        rules: {
          ...(typeof a11yParameters.config === "object" && a11yParameters.config !== null
            ? ((a11yParameters.config as { rules?: Record<string, { enabled?: boolean }> }).rules ??
              {})
            : {}),
          ...rulesConfig,
        },
      };

      const axe = new AxeBuilder({ page })
        .include("#storybook-root")
        .options(mergedOptions as Parameters<AxeBuilder["options"]>[0]);

      const results = await axe.analyze();

      const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(String(v.impact)));
      const warnings = results.violations.filter((v) => !BLOCKING_IMPACTS.has(String(v.impact)));

      if (warnings.length > 0) {
         
        console.warn(
          `[a11y:warn] ${context.title} / ${context.name} → ${warnings
            .map((v) => `${v.id}(${v.impact})`)
            .join(", ")}`,
        );
      }

      if (blocking.length > 0) {
        const details = blocking
          .map(
            (v) =>
              `  • ${v.id} [${v.impact}] — ${v.help}\n    ${v.helpUrl}\n    nodes: ${v.nodes
                .map((n) => n.target.join(" "))
                .slice(0, 3)
                .join(" | ")}`,
          )
          .join("\n");
        throw new Error(
          `Accessibility violations (critical/serious) in "${context.title} / ${context.name}":\n${details}`,
        );
      }
    }

    // ── Visual regression: jest-image-snapshot ───────────────────────
    // Opt-out per story via parameters.snapshot.disable = true.
    const snapshotParameters = (storyContext.parameters?.snapshot ?? {}) as {
      disable?: boolean;
      threshold?: number;
    };

    if (snapshotParameters.disable) {
      return;
    }

    ensureMatcher();

    const image = await page.screenshot({
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });

    // Filename = <title>__<story-name>. Sanitise path separators / spaces
    // so the baselines live in a single flat directory.
    const identifier = `${context.title}--${context.name}`
      .replace(/\s+/g, "-")
      .replace(/\//g, "-")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .toLowerCase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (expect(image) as any).toMatchImageSnapshot({
      customSnapshotsDir: SNAPSHOT_DIR,
      customDiffDir: path.join(SNAPSHOT_DIR, "__diff_output__"),
      customSnapshotIdentifier: identifier,
      // 1% pixel mismatch tolerance — absorbs sub-pixel font rendering
      // jitter that still survives the font-load wait above without
      // hiding genuine layout regressions.
      failureThreshold: snapshotParameters.threshold ?? 0.01,
      failureThresholdType: "percent",
      // SSIM is slower but much more forgiving of font anti-aliasing
      // differences between the dev machine and the GitHub Actions runner.
      comparisonMethod: "ssim",
    });
  },
};

export default config;
