import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow the dashboard to be opened in dev from other hosts on the lab LAN
  // (e.g. a browser on another machine hitting the dev server by its LAN IP),
  // not just localhost. Dev-only; has no effect on a production build.
  allowedDevOrigins: ["192.168.1.7"],
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
