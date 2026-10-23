import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // The admin problem editor sends all tests in one Server Action call
      // (capped at ~3 MB by src/lib/problem-input.ts). Default is 1 MB.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
