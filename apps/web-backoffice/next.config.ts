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
};

export default withNextIntl(nextConfig);
