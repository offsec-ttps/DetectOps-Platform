import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: "/media/nested/SamsungEvo/Test-Projects/detection-platform",
  },
  async rewrites() {
    const backendUrl = process.env.SENTINELFLOW_API_URL || "http://localhost:8000";
    return [
      {
        source: "/api/sentinel/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
