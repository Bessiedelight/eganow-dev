import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: rootDir,
  },

  images: {
    remotePatterns: [{ hostname: "images.pexels.com" }],
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
