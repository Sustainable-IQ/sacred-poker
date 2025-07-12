import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true, // ✅ Allow build even with lint errors
  },
};

export default nextConfig;
