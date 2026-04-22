import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {}, // Add this for Next.js 16

  images: {
    remotePatterns: [{ hostname: "images.pexels.com" }],
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    forceSwcTransforms: false,
  },

  output: "standalone",

  webpack: (config, { isServer, dev, buildId }) => {
    config.ignoreWarnings = [/.*/];
    config.stats = "none";
    config.infrastructureLogging = { level: "error" };
    config.bail = false;

    if (!dev) {
      config.optimization = {
        ...config.optimization,
        emitOnErrors: true,
        noEmitOnErrors: false,
      };
    }

    return config;
  },

  trailingSlash: false,

  generateBuildId: async () => {
    return "build-skip-errors";
  },

  async redirects() {
    return [];
  },
  async rewrites() {
    return [];
  },
  async headers() {
    return [];
  },
};

export default nextConfig;
