import type { NextConfig } from "next";

// Baseline security headers. CSP is deliberately limited to directives that cannot
// break the app (Next inline bootstrap scripts, CodeMirror, Mermaid): no framing
// (clickjacking), no plugins, no <base> hijack, forms post only to self.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Allow the dashboard to be opened in dev from other hosts on the lab LAN
  // (e.g. a browser on another machine hitting the dev server by its LAN IP),
  // not just localhost. Dev-only; has no effect on a production build.
  // Extra hosts allowed to reach the dev server cross-origin (HMR), beyond
  // localhost — e.g. a LAN IP or the server's public IP. Set ALLOWED_DEV_ORIGINS
  // (comma-separated) for your deployment. Dev-only; no effect on a prod build.
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS
    ? process.env.ALLOWED_DEV_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : [],
  turbopack: {
    root: process.env.TURBOPACK_ROOT || process.cwd(),
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
  // Dev file-watcher ignore list. These project-local paths change CONSTANTLY at
  // runtime and must not trigger HMR, or the page reloads in a tight loop:
  //  - dev.db* : SQLite is written on every API call, so the page's own polling
  //    would retrigger a reload each time (self-sustaining loop).
  //  - labs/deployments : running VirtualBox VM disks (.vmdk/.sav) write continuously.
  //  - reports / graphify-out / *.log : generated artifacts written during runs.
  // (Honoured by the webpack dev watcher — run `next dev --webpack`.)
  webpack: (config, { dev }) => {
    if (dev) {
      const extra = [
        "**/.git/**",
        "**/node_modules/**",
        "**/.next/**",
        "**/labs/deployments/**",
        "**/labs/.cache/**",
        "**/reports/**",
        "**/graphify-out/**",
        "**/*.db",
        "**/*.db-journal",
        "**/*.db-wal",
        "**/*.db-shm",
        "**/*.log",
      ];
      // webpack's array form of `ignored` must be all string globs (no RegExp),
      // so we replace the default list with our own (which re-includes the
      // standard node_modules/.next/.git ignores above).
      config.watchOptions = { ...config.watchOptions, ignored: extra };
    }
    return config;
  },
};

export default nextConfig;
