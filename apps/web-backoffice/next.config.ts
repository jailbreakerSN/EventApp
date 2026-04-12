import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

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
  // CSP is intentionally *not* set here yet — a strict policy requires a
  // tested allowlist for Firebase Auth, Google sign-in, and Firestore/FCM
  // endpoints. Adding it blind risks breaking login flows in production.
  // Treat this as a staged rollout: HSTS + framing + content-type controls
  // first, CSP in a follow-up.
  async headers() {
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
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
