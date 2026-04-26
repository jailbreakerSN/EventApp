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
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
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
  poweredByHeader: false,
  // ─── Security headers ─────────────────────────────────────────────────────
  // Wave 10 / W10-P2 / S1 — CSP rolled out in **Report-Only** mode.
  // Same allowlist posture as the backoffice (see web-backoffice/
  // next.config.ts for the rationale per directive). One participant-
  // specific delta: `media-src` is allow-listed for blob: + the
  // sponsor-uploaded video / audio surface served from Firebase
  // Storage.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://browser.sentry-cdn.com https://*.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://storage.googleapis.com https://lh3.googleusercontent.com https://www.gravatar.com",
      "media-src 'self' blob: https://firebasestorage.googleapis.com https://storage.googleapis.com",
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
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Participant app uses the camera for QR badge scanning, so we
          // allow camera=(self). Everything else stays denied.
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=()",
          },
          // Firebase popup-based auth needs to open windows that retain an
          // opener reference; `same-origin-allow-popups` preserves process
          // isolation for regular navigations while letting auth popups work.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
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

// Wave 10 / W10-P1 — Sentry instrumentation. Same wrapper posture as
// web-backoffice. The participant app is the public funnel; Web
// Vitals capture is its primary observability use case (SEO + UX
// metrics on flaky African networks).
const sentryWebpackPluginOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT_PARTICIPANT ?? "teranga-web-participant",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  errorHandler: () => undefined,
  hideSourceMaps: true,
  disableLogger: true,
};

export default withSentryConfig(withNextIntl(nextConfig), sentryWebpackPluginOptions);
