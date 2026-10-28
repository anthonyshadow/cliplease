import type { NextConfig } from "next";

// Read raw: next build fixes these headers into its manifest, and importing src/server/env.ts here would make every
// config load (typegen included) need a complete env. Build and start with the same APP_ENV.
const isProduction = process.env.APP_ENV === "production";
const NOINDEX = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
// Buyer-token pages (02 §9.5): the key is in the URL, so no referrer leaves them.
const BUYER_TOKEN = [
  ...NOINDEX,
  { key: "Referrer-Policy", value: "no-referrer" },
];

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
  // 02 §4.6. When two rules set one key the later wins, so the buyer-token rows follow /(.*). The /verify (P20) and
  // /licenses, /api/my (P20b) rows come with their pages; CSP is [H2].
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
      { source: "/r/:path*", headers: BUYER_TOKEN },
      { source: "/l/:path*", headers: BUYER_TOKEN },
      { source: "/api/licenses/:path*", headers: BUYER_TOKEN },
    ];
  },
  // /@handle and /@handle/slug are served by /u/[handle] and the license page /u/[handle]/[slug] (02 §4.3; afterFiles,
  // the array form). Never redirect /u/* to /@*.
  async rewrites() {
    return [
      { source: "/@:handle", destination: "/u/:handle" },
      { source: "/@:handle/:slug", destination: "/u/:handle/:slug" },
    ];
  },
  // The dev storage route's signed URLs carry object keys, upload ids and signatures, and buyer links their key: keep
  // them out of `next dev`'s request log (P10a, P16a: never log them).
  logging: {
    incomingRequests: {
      ignore: [/\/api\/dev\/storage\//, /^\/(?:r|l|api\/licenses)\//],
    },
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
};

export default nextConfig;
