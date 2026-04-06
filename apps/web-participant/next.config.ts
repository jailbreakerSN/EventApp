import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
