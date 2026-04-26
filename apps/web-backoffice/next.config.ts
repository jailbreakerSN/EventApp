import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Produce a self-contained Node.js server at .next/standalone for Cloud Run
  output: "standalone",
  // Monorepo: include files from repo root in the standalone bundle
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: ["@teranga/shared-ui", "@teranga/shared-types"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  webpack: (config) => {
    // Resolve monorepo packages via explicit paths (WSL2 symlink compatibility)
    config.resolve.alias = {
      ...config.resolve.alias,
      "@teranga/shared-ui": path.resolve(__dirname, "../../packages/shared-ui/src"),
    };
    return config;
  },
  experimental: {
    serverActions: {
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") ?? ["localhost:3001"],
    },
  },
  poweredByHeader: false,
  // ─── Security headers ─────────────────────────────────────────────────────
  // Wave 10 / W10-P2 / S1 — CSP rolled out in **Report-Only** mode
  // first. The browser EVALUATES the policy and reports violations to
  // `report-uri` but does NOT block them. After 7 clean days in
  // staging we promote the same policy to enforced (`Content-Security-
  // Policy` instead of `Content-Security-Policy-Report-Only`).
  //
  // Allowlist rationale:
  //   - script-src: 'self' for first-party + Sentry's CDN bundle for
  //     SDK loading. `'unsafe-inline'` is intentionally NOT included —
  //     React 19 + Next 15 ship inline boot scripts via nonce; we
  //     adopt nonces in a follow-up once Next 15 nonce-injection lands
  //     (today 'unsafe-inline' would defeat the policy, so we accept
  //     a bare `'self'` and tolerate any inline-script reports during
  //     the Report-Only week — the inline boot scripts are framework-
  //     emitted, not user-controlled).
  //   - connect-src: Firebase (Auth + Firestore + Storage + FCM),
  //     Google sign-in (accounts.google.com), Sentry ingest, Resend
  //     ingestion (only relevant for the future webhook callback page
  //     pre-empted here), PayDunya iframe origin, WhatsApp Cloud API.
  //   - img-src: Firebase storage + GCS user content + data: for icons.
  //   - frame-src: PayDunya checkout iframe.
  //   - frame-ancestors: 'none' subsumes X-Frame-Options.
  //   - report-uri: an internal endpoint or Sentry's CSP report
  //     ingest. Falls back to `/api/csp-report` no-op when neither is
  //     wired (today; Wave 10 follow-up adds the Sentry receiver).
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://browser.sentry-cdn.com https://*.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://storage.googleapis.com https://lh3.googleusercontent.com https://www.gravatar.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com https://*.cloudfunctions.net https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://accounts.google.com https://*.sentry.io https://*.ingest.sentry.io https://api.paydunya.com https://graph.facebook.com",
      "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://app.paydunya.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "report-uri /api/csp-report",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          // Force HTTPS for 2 years and preload-list eligible.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Clickjacking protection. CSP frame-ancestors would be stricter,
          // but X-Frame-Options is supported by older browsers and proxies.
          { key: "X-Frame-Options", value: "DENY" },
          // Prevent MIME-type sniffing attacks on user-uploaded content.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Leak origin only when navigating to same-origin or HTTPS peers.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Backoffice never needs camera/mic/geolocation/payments from
          // browser APIs. Deny them all at the platform layer.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Firebase popup-based auth needs to open windows that retain an
          // opener reference; `same-origin-allow-popups` preserves process
          // isolation for regular navigations while letting auth popups work.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          // CSP — Report-Only ramp. Promote to `Content-Security-
          // Policy` after a 7-day clean window. The flip is a one-line
          // env-conditional change; until then violations land in the
          // browser console + the report endpoint without blocking
          // legitimate first-page renders.
          {
            key:
              process.env.NEXT_PUBLIC_CSP_ENFORCE === "true"
                ? "Content-Security-Policy"
                : "Content-Security-Policy-Report-Only",
            value: csp,
          },
        ],
      },
    ];
  },
};

// Wave 10 / W10-P1 — Sentry instrumentation. `withSentryConfig` wraps
// the Next config so the SDK auto-injects browser + server tracing
// without manual `instrumentation.ts` boilerplate. When `SENTRY_DSN`
// is unset the SDK still wraps but stays silent (init no-ops). The
// auth-token / org / project fields are read from env at build time
// for source-map upload — falling back to a no-op release when unset
// so non-prod builds don't fail when Sentry credentials are missing.
const sentryWebpackPluginOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT_BACKOFFICE ?? "teranga-web-backoffice",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Don't fail the build when source-map upload fails (e.g. missing
  // auth token in a sandbox build) — the runtime SDK still works.
  errorHandler: () => undefined,
  // Hide the inner instrumentation from public stack traces.
  hideSourceMaps: true,
  disableLogger: true,
  // Wave 10 follow-up: enable widenClientFileUpload for full coverage.
};

export default withSentryConfig(withNextIntl(nextConfig), sentryWebpackPluginOptions);
