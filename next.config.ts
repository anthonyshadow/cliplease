import type { NextConfig } from "next";

// Read raw: next build fixes these headers into its manifest, and importing src/server/env.ts here would make every
// config load (typegen included) need a complete env. Build and start with the same APP_ENV.
const isProduction = process.env.APP_ENV === "production";
const NOINDEX = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // 02 §4.6. The /r, /l, /api/licenses and /verify rows come with their pages (P17, P20); CSP is [H2].
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(isProduction
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
      { source: "/sign-in", headers: NOINDEX },
      { source: "/dashboard/:path*", headers: NOINDEX },
      { source: "/onboarding", headers: NOINDEX },
      { source: "/admin/:path*", headers: NOINDEX },
    ];
  },
  // /@handle is served by /u/[handle] (02 §4.3; afterFiles, the array form). Never redirect /u/* to /@*.
  async rewrites() {
    return [{ source: "/@:handle", destination: "/u/:handle" }];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
};

export default nextConfig;
