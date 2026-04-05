import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") ?? ["localhost:3001"],
    },
  },
  poweredByHeader: false,
};

export default nextConfig;
